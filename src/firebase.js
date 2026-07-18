import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);
