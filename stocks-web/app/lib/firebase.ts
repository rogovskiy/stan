import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Validate that all required environment variables are present
const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID'
];

// Only validate and throw on server-side to avoid client-side crashes
// Client-side will get a more graceful error when trying to use Firebase
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  const errorMessage = `Missing required Firebase environment variables: ${missingVars.join(', ')}.\n\n` +
    `Please ensure:\n` +
    `1. Your .env.local file exists in the stocks-web directory\n` +
    `2. All required variables are set in .env.local\n` +
    `3. You have restarted your Next.js dev server after adding/modifying .env.local\n\n` +
    `Required variables:\n${requiredEnvVars.map(v => `  - ${v}`).join('\n')}`;
  
  // Only throw on server-side, log warning on client-side
  if (typeof window === 'undefined') {
    throw new Error(errorMessage);
  } else {
    // On client-side, just log a warning - don't crash the app
    console.warn('⚠️ Firebase Configuration Warning: Some environment variables are missing.');
  }
}

// Initialize Firebase (avoid multiple initializations)
// Only initialize if we have the minimum required config
let app;
try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
} catch (error) {
  if (typeof window === 'undefined') {
    // Re-throw on server-side
    throw error;
  } else {
    // On client-side, log error but don't crash
    console.error('Failed to initialize Firebase:', error);
    // Create a dummy app object to prevent crashes
    app = null as any;
  }
}

// Initialize Cloud Firestore and get a reference to the service
export const db = app ? getFirestore(app) : null as any;

// Initialize Firebase Storage and get a reference to the service
export const storage = app ? getStorage(app) : null as any;

// Initialize Firebase Auth and get a reference to the service
export const auth = app ? getAuth(app) : null as any;

export default app;