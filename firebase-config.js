// Firebase configuration for Pawsome Vet
// Uses Firebase v9 compat SDK loaded via CDN script tags

const firebaseConfig = {
  apiKey: "AIzaSyApuvjQ64Rxv1DO0OnHw9K8eV5sjs8zKa0",
  authDomain: "vet1-15a23.firebaseapp.com",
  projectId: "vet1-15a23",
  storageBucket: "vet1-15a23.firebasestorage.app",
  messagingSenderId: "145302116699",
  appId: "1:145302116699:web:c79783165e1a152685227e",
  measurementId: "G-BLED39626E"
};

firebase.initializeApp(firebaseConfig);
window.PawsomeDB = firebase.firestore();
window.PawsomeAuth = typeof firebase.auth === 'function' ? firebase.auth() : null;
window.PawsomeStorage = typeof firebase.storage === 'function' ? firebase.storage() : null;
