// ── FIREBASE CONFIG ──
// TODO: Replace with your actual Firebase project config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBFbG1u6cEnvZxjpMAP1-5epVw0LHZ7WqM",
  authDomain: "couple-calendar-60cb9.firebaseapp.com",
  projectId: "couple-calendar-60cb9",
  storageBucket: "couple-calendar-60cb9.firebasestorage.app",
  messagingSenderId: "870173348010",
  appId: "1:870173348010:web:b7afde9f4fd8b2bf2e80d3"
};


// Allowed users
const ALLOWED_EMAILS = [
  'juanrubio2277@gmail.com',
  'greisisayoja@gmail.com'
];

const USER_CONFIG = {
  'juanrubio2277@gmail.com': {
    name: 'Juan',
    shortName: 'J',
    colorClass: 'juan',
    color: '#818cf8'
  },
  'greisisayoja@gmail.com': {
    name: 'Greisi',
    shortName: 'G',
    colorClass: 'greisi',
    color: '#f472b6'
  }
};

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export { auth, db, provider, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp,
  Timestamp, ALLOWED_EMAILS, USER_CONFIG };
