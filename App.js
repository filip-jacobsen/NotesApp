import { StatusBar } from 'expo-status-bar';
import { FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { createElement, useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, increment, onSnapshot, serverTimestamp, Timestamp, updateDoc} from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { database, storage } from './firebase';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MapScreen from './MapScreen';

const Stack = createNativeStackNavigator();

function NotesScreen({ navigation }) {
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const notesCollection = collection(database, 'notes');
    const unsubscribe = onSnapshot(
      notesCollection,
      (snapshot) => {
        const nextNotes = snapshot.docs.map((noteDocument) => ({
          ...noteDocument.data(),
          id: noteDocument.id,
        }));
        setNotes(sortNotes(nextNotes));
        setError('');
      },
      (snapshotError) => setError(snapshotError.message)
    );

    return unsubscribe;
  }, []);

  async function addNote() {
    const noteText = text.trim();
    if (noteText === '') {
      return;
    }

    try {
      await addDoc(collection(database, 'notes'), {
        text: noteText,
        images: [],
        likes: 0,
        dueAt: dueDate ? Timestamp.fromDate(dueDate) : null,
        createdAt: serverTimestamp(),
      });
      setText('');
      setDueDate(null);
      setError('');
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function deleteNote(note) {
    try {
      for (const image of note.images ?? []) {
        await deleteObject(ref(storage, image.path));
      }
      await deleteDoc(doc(database, 'notes', note.id));
      setError('');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function likeNote(noteId) {
    try {
      await updateDoc(doc(database, 'notes', noteId), { likes: increment(1) });
    } catch (likeError) {
      setError(likeError.message);
    }
  }

  return (
    <ScreenBackground>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>YOUR NOTEBOOK</Text>
        <Text style={styles.title}>My Notes</Text>
        <TextInput
          style={styles.input}
          placeholder="Write a new note..."
          value={text}
          onChangeText={setText}
        />
        <DateTimeField value={dueDate} onChange={setDueDate} />
        <Pressable style={styles.primaryButton} onPress={addNote}>
          <Text style={styles.primaryButtonText}>ADD NOTE</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Map')}
        >
          <Text style={styles.secondaryButtonText}>OPEN COPENHAGEN MAP</Text>
        </Pressable>
        {error !== '' && <Text style={styles.error}>{error}</Text>}
        <FlatList
          style={styles.list}
          data={notes}
          keyExtractor={(note) => note.id}
          renderItem={({ item }) => (
            <NoteCard
              note={item}
              onOpen={() => navigation.navigate('NoteDetail', { note: item })}
              onLike={() => likeNote(item.id)}
              onDelete={() => deleteNote(item)}
            />
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No notes yet. Add one above.</Text>}
        />
      </View>
    </ScreenBackground>
  );
}

function NoteDetailScreen({ route, navigation }) {
  const { note } = route.params;
  const [noteData, setNoteData] = useState(note);
  const [text, setText] = useState(note.text ?? '');
  const [dueDate, setDueDate] = useState(() => note.dueAt?.toDate?.() ?? null);
  const [pendingImages, setPendingImages] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const noteRef = doc(database, 'notes', note.id);
    const unsubscribe = onSnapshot(
      noteRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setNoteData({ ...snapshot.data(), id: snapshot.id });
        } else {
          navigation.goBack();
        }
      },
      (snapshotError) => setError(snapshotError.message)
    );

    return unsubscribe;
  }, [navigation, note.id]);

  async function chooseImages() {
    setError('');

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 0.75,
      });

      if (!result.canceled) {
        const selectedAt = Date.now();
        setPendingImages(result.assets.map((asset, index) => ({
          ...asset,
          draftId: `${selectedAt}-${index}`,
        })));
      }
    } catch (pickerError) {
      setError(pickerError.message);
    }
  }

  async function uploadSelectedImages() {
    setUploading(true);
    setError('');

    try {
      for (const asset of pendingImages) {
        const imageId = doc(collection(database, 'notes')).id;
        const imageRef = ref(storage, `notes/${note.id}/${imageId}`);
        let file = asset.file;
        let uploadSnapshot;

        try {
          if (!file) {
            file = await uriToBlob(asset.uri);
          }

          uploadSnapshot = await uploadBytes(imageRef, file, {
            contentType: asset.mimeType ?? asset.file?.type ?? 'image/jpeg',
          });
          const image = {
            id: imageId,
            path: uploadSnapshot.ref.fullPath,
            url: await getDownloadURL(uploadSnapshot.ref),
          };

          await updateDoc(doc(database, 'notes', note.id), {
            images: arrayUnion(image),
          });
          setPendingImages((currentImages) =>
            currentImages.filter((currentImage) => currentImage.draftId !== asset.draftId)
          );
        } catch (uploadError) {
          if (uploadSnapshot) {
            await deleteObject(uploadSnapshot.ref).catch(() => {});
          }
          throw uploadError;
        } finally {
          if (!asset.file && typeof file?.close === 'function') {
            file.close();
          }
        }
      }
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(image) {
    setError('');

    try {
      await updateDoc(doc(database, 'notes', note.id), {
        images: arrayRemove(image),
      });
      await deleteObject(ref(storage, image.path));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError('');

    try {
      await updateDoc(doc(database, 'notes', note.id), {
        text,
        dueAt: dueDate ? Timestamp.fromDate(dueDate) : null,
      });
      navigation.goBack();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.detailContent}>
        <Text style={styles.eyebrow}>NOTE DETAILS</Text>
        <Text style={styles.title}>Edit your note</Text>
        <TextInput
          style={styles.editor}
          multiline
          textAlignVertical="top"
          value={text}
          onChangeText={setText}
          placeholder="Write your note..."
        />
        <DateTimeField value={dueDate} onChange={setDueDate} />
        <View style={styles.locationSection}>
          <Text style={styles.sectionTitle}>LOCATION</Text>
          <Text style={styles.locationHint}>
            {isValidCoordinate(noteData.location)
              ? `Saved at ${formatLocation(noteData.location)}`
              : 'Add a place to remember where this note belongs.'}
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Map', { noteId: note.id })}
          >
            <Text style={styles.secondaryButtonText}>
              {noteData.location ? 'CHANGE LOCATION ON MAP' : 'PICK LOCATION ON MAP'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.sectionTitle}>PHOTOS</Text>
        {noteData.images?.map((image) => (
          <View key={image.id} style={styles.detailImageItem}>
            <Image source={{ uri: image.url }} style={styles.detailImage} />
            <Pressable style={styles.removeImageButton} onPress={() => deleteImage(image)}>
              <Text style={styles.removeImageText}>REMOVE PHOTO</Text>
            </Pressable>
          </View>
        ))}
        {pendingImages.map((image) => (
          <View key={image.draftId} style={styles.detailImageItem}>
            <Image source={{ uri: image.uri }} style={styles.detailImage} />
            <Pressable
              style={styles.removeImageButton}
              onPress={() => setPendingImages((currentImages) =>
                currentImages.filter((currentImage) => currentImage.draftId !== image.draftId)
              )}
              disabled={uploading}
            >
              <Text style={styles.removeImageText}>REMOVE SELECTED</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.secondaryButton} onPress={chooseImages} disabled={uploading}>
          <Text style={styles.secondaryButtonText}>CHOOSE PHOTOS</Text>
        </Pressable>
        {pendingImages.length > 0 && (
          <Pressable
            style={[styles.primaryButton, uploading && styles.disabledButton]}
            onPress={uploadSelectedImages}
            disabled={uploading}
          >
            <Text style={styles.primaryButtonText}>
              {uploading ? 'UPLOADING...' : 'UPLOAD SELECTED PHOTOS'}
            </Text>
          </Pressable>
        )}
        {error !== '' && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={[styles.primaryButton, saving && styles.disabledButton]}
          onPress={saveNote}
          disabled={saving}
        >
          <Text style={styles.primaryButtonText}>{saving ? 'SAVING...' : 'GEM'}</Text>
        </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}

function NoteCard({ note, onOpen, onLike, onDelete }) {
  const preview = note.text.length > 25 ? `${note.text.slice(0, 25)}...` : note.text;

  return (
    <View style={styles.noteCard}>
      <View style={styles.noteRow}>
        <Pressable style={styles.noteOpenArea} onPress={onOpen}>
          <Text style={styles.noteText}>{preview}</Text>
          <Text style={styles.openNote}>OPEN</Text>
        </Pressable>
        <Pressable
          style={styles.deleteButton}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete note: ${note.text}`}
        >
          <Text style={styles.deleteButtonText}>SLET</Text>
        </Pressable>
      </View>
      <Text style={styles.dueDate}>{formatDueDate(note.dueAt)}</Text>
      {note.location && <Text style={styles.locationLabel}>LOCATION SAVED</Text>}
      {note.images?.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRail}>
          {note.images.map((image) => (
            <Image key={image.id} source={{ uri: image.url }} style={styles.feedImage} />
          ))}
        </ScrollView>
      )}
      <Pressable style={styles.likeButton} onPress={onLike}>
        <Text style={styles.likeText}>LIKE  {note.likes ?? 0}</Text>
      </Pressable>
    </View>
  );
}

function uriToBlob(uri) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.onload = () => resolve(request.response);
    request.onerror = () => reject(new TypeError('Could not read the selected image.'));
    request.responseType = 'blob';
    request.open('GET', uri, true);
    request.send(null);
  });
}

function DateTimeField({ value, onChange }) {
  const [pickerMode, setPickerMode] = useState(null);

  return (
    <View style={styles.dateField}>
      <Text style={styles.dateLabel}>EVENT DATE & TIME (OPTIONAL)</Text>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: 'datetime-local',
          value: value ? toLocalDateTimeInput(value) : '',
          onChange: (event) => onChange(event.target.value ? new Date(event.target.value) : null),
          style: styles.webDateInput,
        })
      ) : (
        <View style={styles.dateButtons}>
          <Pressable style={styles.dateButton} onPress={() => setPickerMode('date')}>
            <Text style={styles.dateButtonText}>{value ? 'CHANGE DATE' : 'PICK DATE'}</Text>
          </Pressable>
          <Pressable style={styles.dateButton} onPress={() => setPickerMode('time')}>
            <Text style={styles.dateButtonText}>{value ? 'CHANGE TIME' : 'PICK TIME'}</Text>
          </Pressable>
          {value && (
            <Pressable style={styles.dateButton} onPress={() => onChange(null)}>
              <Text style={styles.dateButtonText}>CLEAR</Text>
            </Pressable>
          )}
          {pickerMode && (
            <DateTimePicker
              value={value ?? new Date()}
              mode={pickerMode}
              onChange={(event, selectedDate) => {
                setPickerMode(null);
                if (event.type === 'set' && selectedDate) {
                  onChange(selectedDate);
                }
              }}
            />
          )}
        </View>
      )}
      <Text style={styles.dateHint}>
        {value ? value.toLocaleString() : 'Leave empty for an anytime note'}
      </Text>
    </View>
  );
}

function sortNotes(notes) {
  return notes.sort((first, second) => {
    const firstDueAt = first.dueAt?.toMillis?.() ?? null;
    const secondDueAt = second.dueAt?.toMillis?.() ?? null;

    if (firstDueAt !== null && secondDueAt !== null) {
      return firstDueAt - secondDueAt;
    }
    if (firstDueAt !== null) {
      return -1;
    }
    if (secondDueAt !== null) {
      return 1;
    }

    const firstCreatedAt = first.createdAt?.toMillis?.() ?? 0;
    const secondCreatedAt = second.createdAt?.toMillis?.() ?? 0;
    return secondCreatedAt - firstCreatedAt;
  });
}

function formatDueDate(timestamp) {
  const date = timestamp?.toDate?.();
  return date ? date.toLocaleString() : 'ANYTIME';
}

function isValidCoordinate(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

function formatLocation(location) {
  return isValidCoordinate(location)
    ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
    : 'Saved location';
}

function toLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ScreenBackground({ children }) {
  return (
    <LinearGradient
      colors={['#E76F51', '#F4A261', '#E9C46A', '#2A9D8F', '#457B9D']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      {children}
    </LinearGradient>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#FFF9EF' },
          headerTintColor: '#253238',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#FFF9EF' },
        }}
      >
        <Stack.Screen name="Notes" component={NotesScreen} options={{ title: 'My Notes' }} />
        <Stack.Screen
          name="NoteDetail"
          component={NoteDetailScreen}
          options={{ title: 'Note details' }}
        />
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{ title: 'Copenhagen map' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    paddingTop: 28,
  },
  eyebrow: {
    color: '#253238',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#253238',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#FFF9EF',
    borderColor: '#253238',
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  dateField: {
    marginBottom: 14,
  },
  dateLabel: {
    color: '#253238',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  dateButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateButton: {
    alignItems: 'center',
    backgroundColor: '#FFF9EF',
    borderColor: '#253238',
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  dateButtonText: {
    color: '#253238',
    fontSize: 11,
    fontWeight: '700',
  },
  dateHint: {
    color: '#253238',
    fontSize: 13,
    marginTop: 7,
  },
  webDateInput: {
    backgroundColor: '#FFF9EF',
    borderColor: '#253238',
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    color: '#253238',
    fontSize: 16,
    minHeight: 44,
    padding: 10,
    width: '100%',
  },
  },
  editor: {
    backgroundColor: '#FFF9EF',
    borderColor: '#253238',
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 150,
    padding: 14,
    fontSize: 18,
    lineHeight: 26,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#253238',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#FFF9EF',
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  list: {
    flex: 1,
    marginTop: 12,
  },
  noteRow: {
    alignItems: 'center',
    backgroundColor: '#FFF9EF',
    borderRadius: 6,
    flexDirection: 'row',
    minHeight: 54,
    paddingVertical: 10,
  },
  noteCard: {
    backgroundColor: '#FFF9EF',
    borderRadius: 6,
    marginBottom: 12,
    overflow: 'hidden',
  },
  noteOpenArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 34,
    paddingHorizontal: 14,
  },
  noteText: {
    color: '#253238',
    flex: 1,
    fontSize: 16,
  },
  dueDate: {
    color: '#287A73',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  openNote: {
    color: '#287A73',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 12,
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 54,
    paddingHorizontal: 10,
  },
  deleteButtonText: {
    color: '#A53D32',
    fontSize: 11,
    fontWeight: '700',
  },
  imageRail: {
    paddingHorizontal: 12,
  },
  feedImage: {
    width: 190,
    height: 142,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 10,
  },
  likeButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  likeText: {
    color: '#287A73',
    fontWeight: '700',
  },
  detailContent: {
    padding: 24,
    paddingTop: 28,
    paddingBottom: 40,
  },
  sectionTitle: {
    color: '#253238',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 10,
  },
  locationSection: {
    marginBottom: 10,
  },
  locationHint: {
    color: '#253238',
    fontSize: 14,
    marginBottom: 10,
  },
  locationLabel: {
    color: '#287A73',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  detailImageItem: {
    backgroundColor: '#FFF9EF',
    borderRadius: 6,
    marginBottom: 12,
    overflow: 'hidden',
  },
  detailImage: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  removeImageButton: {
    alignItems: 'center',
    minHeight: 42,
    justifyContent: 'center',
  },
  removeImageText: {
    color: '#A53D32',
    fontSize: 11,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFF9EF',
    borderColor: '#253238',
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: '#253238',
    fontWeight: '700',
  },
  emptyText: {
    color: '#253238',
    fontSize: 16,
    marginTop: 14,
  },
  error: {
    color: '#7A1616',
    marginBottom: 10,
  },
});