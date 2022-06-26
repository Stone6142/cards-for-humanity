import io from 'socket.io-client';
import { createApp } from "vue";
import VueSocketIO from "vue-3-socket.io";
import App from "./App.vue";
import "./styles/index.scss";

const connection = process.env.NODE_ENV === 'development' ? "http://localhost:8081" : "not yet";

const app =  createApp(App);

app.use(new VueSocketIO({
  debug: false,
  connection,
}))

// app.config.globalProperties.$socket = io(connection);
app.mount('#app')