import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { connect } from './lib/conn.js';
import logo from './assets/logo.svg';

// tab / home-screen icon: the app's logo
for (const rel of ['icon', 'apple-touch-icon']) {
  const l = document.createElement('link');
  l.rel = rel; l.href = logo;
  document.head.appendChild(l);
}

createApp(App).mount('#app');
connect();
