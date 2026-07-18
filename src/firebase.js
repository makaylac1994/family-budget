import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Paste the config object from your Firebase project here.
// Firebase console → Project settings → General → "Your apps" → Web app → SDK setup and configuration
const firebaseConfig = {
  apiKey: 'AIzaSyDgN-IIpahZWW0sozvWzmpMOcxLfj0Bg-M',
  authDomain: 'family-budget-12b6b.firebaseapp.com',
  projectId: 'family-budget-12b6b',
  storageBucket: 'family-budget-12b6b.firebasestorage.app',
  messagingSenderId: '756927007666',
  appId: '1:756927007666:web:a85dfcf6e614dc719a32ab',
};

const app = initializeApp(firebaseConfig);
// ignoreUndefinedProperties: without this, Firestore rejects the ENTIRE write
// whenever any field (e.g. a cleared allocation) is `undefined`, and does so
// silently from the UI's perspective — this is why some saves were failing.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const auth = getAuth(app);
