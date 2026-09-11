// Bowling Tracker Firebase connection.
// Firebase web API keys are public identifiers; Firestore Security Rules protect the data.
window.BOWLING_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAtAD3wBOWSbBSxylF4BU2x5DFK9joHlC8',
  authDomain: 'bowling-tracker-aad74.firebaseapp.com',
  projectId: 'bowling-tracker-aad74',
  storageBucket: 'bowling-tracker-aad74.firebasestorage.app',
  messagingSenderId: '542175163862',
  appId: '1:542175163862:web:69024758262e9324ae6077'
};

// Load the lightweight Profile/goal feature without changing the stable app shell.
(() => {
  if (document.querySelector('script[data-bowling-profile]')) return;
  const script = document.createElement('script');
  script.src = './profile.js';
  script.async = false;
  script.dataset.bowlingProfile = 'true';
  document.head.appendChild(script);
})();
