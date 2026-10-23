import { StyleSheet, Text, View } from 'react-native';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>COPENHAGEN NOTE MAP</Text>
      <Text style={styles.title}>Open the map on your phone</Text>
      <Text style={styles.description}>
        Interactive maps and location notes are available in the iOS and Android app.
        Your notes remain available here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#FFF9EF',
  },
  eyebrow: {
    color: '#287A73',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  title: {
    color: '#253238',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 12,
  },
  description: {
    color: '#253238',
    fontSize: 16,
    lineHeight: 24,
  },
});
