import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { connect } from './lib/conn.js';

createApp(App).mount('#app');
connect();
