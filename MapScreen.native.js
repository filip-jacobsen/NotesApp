import { useEffect, useRef, useState } from 'react';
import {ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import MapView, { Marker } from 'react-native-maps';
import { database } from './firebase';

const COPENHAGEN_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.95,
  longitudeDelta: 1.45,
};

export default function MapScreen({ navigation, route }) {
  const mapRef = useRef(null);
  const targetNoteId = route.params?.noteId;
  const [notes, setNotes] = useState([]);
  const [pendingCoordinate, setPendingCoordinate] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(database, 'notes'),
      (snapshot) => {
        setNotes(snapshot.docs.map((noteDocument) => ({
          ...noteDocument.data(),
          id: noteDocument.id,
        })));
        setError('');
      },
      (snapshotError) => setError(snapshotError.message)
    );

    return unsubscribe;
  }, []);

  const targetNote = notes.find((note) => note.id === targetNoteId);
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  function startNoteAt(coordinate) {
    setPendingCoordinate(coordinate);
    setSelectedNoteId(null);
    setDraftText('');
    setError('');
  }

  async function useCurrentLocation() {
    setLocating(true);
    setError('');

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location permission was not granted. You can still long-press the map to choose a place.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      startNoteAt(coordinate);
      mapRef.current?.animateToRegion({
        ...coordinate,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      });
    } catch (locationError) {
      setError(locationError.message);
    } finally {
      setLocating(false);
    }
  }

  async function saveLocationNote() {
    const text = draftText.trim();
    if (!pendingCoordinate || text === '') {
      setError('Add note text before saving this location.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const savedNote = await addDoc(collection(database, 'notes'), {
        text,
        images: [],
        likes: 0,
        dueAt: null,
        location: pendingCoordinate,
        createdAt: serverTimestamp(),
      });
      setPendingCoordinate(null);
      setSelectedNoteId(savedNote.id);
      setDraftText('');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function attachLocation() {
    if (!targetNoteId || !pendingCoordinate) {
      setError('Long-press the map to choose a location for this note.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateDoc(doc(database, 'notes', targetNoteId), {
        location: pendingCoordinate,
      });
      navigation.goBack();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function openNote(note) {
    navigation.navigate('NoteDetail', { note });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={COPENHAGEN_REGION}
        onLongPress={(event) => startNoteAt(event.nativeEvent.coordinate)}
      >
        {notes.map((note) => (
          isValidCoordinate(note.location) && (
            <Marker
              key={note.id}
              coordinate={note.location}
              pinColor="#E76F51"
              title={note.text ?? 'Saved note'}
              description="Tap to preview this location note"
              onPress={() => {
                setSelectedNoteId(note.id);
                setPendingCoordinate(null);
              }}
            />
          )
        ))}
        {pendingCoordinate && (
          <Marker coordinate={pendingCoordinate} pinColor="#287A73" title="New note location" />
        )}
      </MapView>

      <View style={styles.helpCard} pointerEvents="none">
        <Text style={styles.helpTitle}>
          {targetNoteId ? 'PICK A LOCATION' : 'COPENHAGEN NOTE MAP'}
        </Text>
        <Text style={styles.helpText}>
          {targetNoteId
            ? 'Long-press anywhere on the map to attach this note to that place.'
            : 'Long-press a place to add a note. Saved notes appear as pins.'}
        </Text>
      </View>

      <Pressable
        style={[styles.locationButton, locating && styles.disabledButton]}
        onPress={useCurrentLocation}
        disabled={locating || saving}
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
      >
        {locating ? (
          <ActivityIndicator color="#FFF9EF" />
        ) : (
          <Text style={styles.locationButtonText}>USE MY LOCATION</Text>
        )}
      </Pressable>

      {pendingCoordinate && (
        <View style={styles.bottomCard}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.bottomCardContent}
          >
            {targetNoteId ? (
              <>
                <Text style={styles.cardTitle}>ATTACH THIS PLACE</Text>
                <Text style={styles.cardText}>
                  {targetNote?.text ?? 'This note'} · {formatCoordinate(pendingCoordinate)}
                </Text>
                <Pressable
                  style={[styles.primaryButton, saving && styles.disabledButton]}
                  onPress={attachLocation}
                  disabled={saving}
                >
                  <Text style={styles.primaryButtonText}>
                    {saving ? 'SAVING...' : 'ATTACH LOCATION'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.composerHeader}>
                  <Text style={styles.cardTitle}>ADD A NOTE HERE</Text>
                  <Pressable
                    style={styles.keyboardDoneButton}
                    onPress={() => Keyboard.dismiss()}
                    accessibilityRole="button"
                    accessibilityLabel="Hide keyboard"
                  >
                    <Text style={styles.keyboardDoneText}>DONE</Text>
                  </Pressable>
                </View>
                <Text style={styles.cardText}>{formatCoordinate(pendingCoordinate)}</Text>
                <TextInput
                  style={styles.noteInput}
                  placeholder="What do you want to remember here?"
                  value={draftText}
                  onChangeText={setDraftText}
                  multiline
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  editable={!saving}
                />
                <Pressable
                  style={[styles.primaryButton, saving && styles.disabledButton]}
                  onPress={saveLocationNote}
                  disabled={saving}
                >
                  <Text style={styles.primaryButtonText}>
                    {saving ? 'SAVING...' : 'SAVE NOTE AT THIS PLACE'}
                  </Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={styles.cancelButton}
              onPress={() => {
                Keyboard.dismiss();
                setPendingCoordinate(null);
              }}
              disabled={saving}
            >
              <Text style={styles.cancelButtonText}>CANCEL</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {!pendingCoordinate && selectedNote && (
        <View style={styles.bottomCard}>
          {selectedNote.images?.[0]?.url && (
            <Image source={{ uri: selectedNote.images[0].url }} style={styles.noteImage} />
          )}
          <Text style={styles.cardTitle}>NOTE AT THIS PLACE</Text>
          <Text style={styles.cardText}>{selectedNote.text}</Text>
          {isValidCoordinate(selectedNote.location) && (
            <Text style={styles.coordinateText}>{formatCoordinate(selectedNote.location)}</Text>
          )}
          <Pressable style={styles.primaryButton} onPress={() => openNote(selectedNote)}>
            <Text style={styles.primaryButtonText}>OPEN NOTE</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => setSelectedNoteId(null)}>
            <Text style={styles.cancelButtonText}>CLOSE</Text>
          </Pressable>
        </View>
      )}

      {error !== '' && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function isValidCoordinate(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

function formatCoordinate(location) {
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  helpCard: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    backgroundColor: '#FFF9EF',
    borderRadius: 8,
    padding: 14,
    shadowColor: '#253238',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 4,
  },
  helpTitle: {
    color: '#253238',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  helpText: {
    color: '#253238',
    fontSize: 13,
  },
  locationButton: {
    position: 'absolute',
    top: 106,
    right: 14,
    minHeight: 42,
    justifyContent: 'center',
    backgroundColor: '#253238',
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  locationButtonText: {
    color: '#FFF9EF',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    maxHeight: '65%',
    backgroundColor: '#FFF9EF',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#253238',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  bottomCardContent: {
    paddingBottom: 4,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  keyboardDoneButton: {
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
    marginTop: -6,
  },
  keyboardDoneText: {
    color: '#287A73',
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#253238',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardText: {
    color: '#253238',
    fontSize: 15,
    marginBottom: 12,
  },
  coordinateText: {
    color: '#287A73',
    fontSize: 12,
    marginBottom: 10,
  },
  noteInput: {
    maxHeight: 100,
    minHeight: 48,
    borderColor: '#253238',
    borderRadius: 6,
    borderWidth: 1,
    color: '#253238',
    padding: 10,
    marginBottom: 10,
  },
  noteImage: {
    width: '100%',
    height: 120,
    borderRadius: 6,
    marginBottom: 12,
  },
  primaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#253238',
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: '#FFF9EF',
    fontSize: 12,
    fontWeight: '700',
  },
  cancelButton: {
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  cancelButtonText: {
    color: '#A53D32',
    fontSize: 11,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.65,
  },
  errorCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 158,
    backgroundColor: '#FFF9EF',
    borderRadius: 6,
    padding: 12,
  },
  errorText: {
    color: '#7A1616',
    fontSize: 13,
  },
});
