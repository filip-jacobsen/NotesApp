// Import the functions you need from the SDKs you need
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";


const firebaseConfig = {
  apiKey: "AIzaSyDNfBe1Mi-XWk-RGy-unW7aIzhjhAcMy2E",
  authDomain: "test-33bb1.firebaseapp.com",
  projectId: "test-33bb1",
  storageBucket: "test-33bb1.firebasestorage.app",
  messagingSenderId: "574357920971",
  appId: "1:574357920971:web:f78c255fdbfabdfeeb8f4e",
  measurementId: "G-N6FN3QP6ZV"
};

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const database = getFirestore(app);
export const storage = getStorage(app);