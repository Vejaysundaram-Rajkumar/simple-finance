import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBKX1sYoOkKHM30-zGBuMillUIqMkVQRqE",
  authDomain: "simple-finance-1690c.firebaseapp.com",
  projectId: "simple-finance-1690c",
  storageBucket: "simple-finance-1690c.firebasestorage.app",
  messagingSenderId: "125838537133",
  appId: "1:125838537133:web:de7814cf0bd447185ef124",
  measurementId: "G-RVR53FL991",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();