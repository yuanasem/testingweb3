// =====================================================
// REVISI TOTAL KONEKTIVITAS: HIVEMQ & MONGODB ATLAS API
// =====================================================

const TOKEN_KEY = "token";
const USER_KEY = "ecg_current_user";

// Konfigurasi Kritis Broker HiveMQ Cloud
const MQTT_CONFIG = {
  broker: "b12be20128b4431fa7257c750cb205d6.s1.eu.hivemq.cloud", 
  port: 8884,                                            // PERBAIKAN: Port Secure WebSocket HiveMQ Cloud Free Tier
  path: "/mqtt",
  useSSL: true,
  username: "monitoring_ecg",                           // PERBAIKAN: Wajib isi Username dari menu Access Management (Sama dengan ESP32)
  password: "PasswordEcg123",                           // PERBAIKAN: Wajib isi Password dari menu Access Management (Sama dengan ESP32)
  topics: ["esp32/lead1", "esp32/lead2", "esp32/lead3"]
};

const USE_DUMMY_STREAM_WHEN_MQTT_FAILS = true;

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getSessionUser() {
  return JSON.parse(localStorage.getItem(USER_KEY) || "null");
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = "dashboard.html";
}

function redirectToIndex() {
  window.location.href = "index.html";
}

function redirectToDashboardLogin() {
  window.location.href = "dashboard.html";
}

function showAuthMessage(type, message) {
  const box = document.getElementById("authMessage");
  if (!box) return;
  box.className = "auth-message show " + type;
  box.textContent = message;
}

function initLoginPage() {
  if (localStorage.getItem(TOKEN_KEY)) {
    redirectToIndex();
    return;
  }

  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authBtn = document.getElementById("authBtn");
  const loginTab = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  const usernameGroup = document.getElementById("usernameGroup");
  const usernameInput = document.getElementById("username");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const togglePassword = document.getElementById("togglePassword");
  const demoLoginBtn = document.getElementById("demoLoginBtn");

  let isLoginMode = true;

  // Bersihkan nilai bawaan agar tidak tertukar data lama
  emailInput.value = "";
  passwordInput.value = "";

  function setMode(loginMode) {
    isLoginMode = loginMode;
    loginTab.classList.toggle("active", isLoginMode);
    signupTab.classList.toggle("active", !isLoginMode);
    usernameGroup.classList.toggle("hidden", isLoginMode);
    authTitle.textContent = isLoginMode ? "Login Dashboard" : "Sign Up Akun";
    authBtn.textContent = isLoginMode ? "Masuk ke Index" : "Daftar Akun";
  }

  loginTab.addEventListener("click", () => setMode(true));
  signupTab.addEventListener("click", () => setMode(false));

  togglePassword.addEventListener("click", () => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    togglePassword.textContent = visible ? "Lihat" : "Sembunyi";
  });

  // Fitur Demo Bypass Terproteksi Lokal Sederhana
  demoLoginBtn.addEventListener("click", () => {
    setSession("demo-token", { username: "Demo Guest", email: "demo@ecg.com" });
    redirectToIndex();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const username = usernameInput.value.trim();

    if (!email || !password) {
      showAuthMessage("error", "Email dan password wajib diisi.");
      return;
    }
    if (password.length < 6) {
      showAuthMessage("error", "Password minimal 6 karakter.");
      return;
    }

    const endpoint = isLoginMode ? "/api/login" : "/api/signup";
    const payload = isLoginMode ? { email, password } : { email, username, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        showAuthMessage("error", result.error || "Terjadi kesalahan transmisi data.");
        return;
      }

      if (isLoginMode) {
        setSession(result.token, result.user);
        redirectToIndex();
      } else {
        showAuthMessage("success", "Akun berhasil didaftarkan! Silakan masuk menggunakan tab Login.");
        setMode(true);
        emailInput.value = email;
        passwordInput.value = "";
      }
    } catch (err) {
      showAuthMessage("error", "Gagal menghubungi server database.");
    }
  });
}

function initIndexPage() {
  if (!localStorage.getItem(TOKEN_KEY)) {
    redirectToDashboardLogin();
    return;
  }
  const user = getSessionUser() || { username: "User" };
  const welcomeUser = document.getElementById("welcomeUser");
  const logoutBtn = document.getElementById("logoutBtn");

  if (welcomeUser) welcomeUser.textContent = "Selamat datang, " + user.username;
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  initECGDashboard();
}

function initECGDashboard() {
  const ctxMain = document.getElementById("ecgChartMain");
  const ctxAug = document.getElementById("ecgChartAug");
  const statusBadge = document.getElementById("conn-status");
  const recordLog = document.getElementById("recordLog");
  const recordBtn = document.getElementById("recordBtn");
  const exportBtn = document.getElementById("exportBtn");
  const recordStatus = document.getElementById("recordStatus");
  const dataCount = document.getElementById("dataCount");
  const dataSource = document.getElementById("dataSource");

  if (!ctxMain || !ctxAug || typeof Chart === "undefined") return;

  let isRecording = false;
  let recordedData = [["Timestamp", "Lead", "Value", "Source"]];
  let lastLeads = { L1: 0, L2: 0, L3: 0 };
  let mqttConnected = false;
  let dummyInterval = null;

  const MAX_DATA_POINTS = 120;
  const labels = Array(MAX_DATA_POINTS).fill("");

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { intersect: false, mode: "index" },
    scales: {
      x: { grid: { display: false }, ticks: { display: false } },
      y: { suggestedMin: -500, suggestedMax: 2000, grid: { color: "rgba(148, 163, 184, 0.18)" } }
    }
  };

  const ecgChart = new Chart(ctxMain.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Lead I", data: [], borderColor: "#2563eb", borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: "Lead II", data: [], borderColor: "#2a9d8f", borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: "Lead III", data: [], borderColor: "#f9c74f", borderWidth: 2, pointRadius: 0, tension: 0.1 }
      ]
    },
    options: chartOptions
  });

  const augChart = new Chart(ctxAug.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "aVR", data: [], borderColor: "#e63946", borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: "aVL", data: [], borderColor: "#7c3aed", borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: "aVF", data: [], borderColor: "#14b8a6", borderWidth: 2, pointRadius: 0, tension: 0.1 }
      ]
    },
    options: chartOptions
  });

  function setConnectionStatus(type, text) {
    statusBadge.className = "status-badge " + type;
    statusBadge.textContent = text;
  }

  function addLog(message) {
    const p = document.createElement("p");
    p.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
    recordLog.prepend(p);
  }

  function pushValue(dataset, value) {
    dataset.data.push(value);
    if (dataset.data.length > MAX_DATA_POINTS) dataset.data.shift();
  }

  function updateCharts(l1, l2, l3, source = "MQTT") {
    lastLeads = { L1: l1, L2: l2, L3: l3 };

    pushValue(ecgChart.data.datasets[0], l1);
    pushValue(ecgChart.data.datasets[1], l2);
    pushValue(ecgChart.data.datasets[2], l3);

    const avr = -0.5 * (l1 + l2);
    const avl = l1 - (0.5 * l2);
    const avf = l2 - (0.5 * l1);

    pushValue(augChart.data.datasets[0], avr);
    pushValue(augChart.data.datasets[1], avl);
    pushValue(augChart.data.datasets[2], avf);

    ecgChart.update("none");
    augChart.update("none");

    if (isRecording) {
      const now = new Date().toLocaleTimeString();
      recordedData.push([now, "Lead I", l1, source]);
      recordedData.push([now, "Lead II", l2, source]);
      recordedData.push([now, "Lead III", l3, source]);
      if (dataCount) dataCount.textContent = String(recordedData.length - 1);
    }
  }

  function startDummyStream() {
    if (!USE_DUMMY_STREAM_WHEN_MQTT_FAILS || dummyInterval) return;
    let t = 0;
    setConnectionStatus("demo", "Demo Stream");
    if (dataSource) dataSource.textContent = "Dummy";
    addLog("Dashboard menggunakan dummy stream otomatis.");

    dummyInterval = setInterval(() => {
      t += 0.2;
      const base = Math.sin(t) * 50;
      const pqrst = Math.exp(-Math.pow((t % 6) - 2, 2) * 20) * 800; 
      const l1 = base + pqrst;
      const l2 = base + pqrst * 1.2;
      const l3 = l2 - l1;
      updateCharts(l1, l2, l3, "Dummy");
    }, 100);
  }

  function stopDummyStream() {
    if (dummyInterval) {
      clearInterval(dummyInterval);
      dummyInterval = null;
    }
  }

  function connectMQTT() {
    if (typeof Paho === "undefined" || !Paho.MQTT) {
      addLog("Library Paho MQTT tidak ditemukan. Mengaktifkan dummy stream...");
      startDummyStream();
      return;
    }

    setConnectionStatus("connecting", "Connecting...");
    addLog("Membuka jabat tangan WebSocket aman ke HiveMQ Cloud...");

    const clientID = "web_monitor_" + Math.random().toString(16).slice(2, 7);
    const client = new Paho.MQTT.Client(MQTT_CONFIG.broker, Number(MQTT_CONFIG.port), MQTT_CONFIG.path, clientID);

    client.onConnectionLost = event => {
      mqttConnected = false;
      setConnectionStatus("disconnected", "Disconnected");
      addLog("Koneksi terputus: " + (event.errorMessage || "Koneksi Hilang"));
      startDummyStream();
      setTimeout(connectMQTT, 5000);
    };

    client.onMessageArrived = message => {
      const value = Number(message.payloadString);
      const topic = message.destinationName;
      if (isNaN(value)) return;

      if (topic === "esp32/lead1") lastLeads.L1 = value;
      if (topic === "esp32/lead2") lastLeads.L2 = value;
      if (topic === "esp32/lead3") lastLeads.L3 = value;

      updateCharts(lastLeads.L1, lastLeads.L2, lastLeads.L3, "MQTT");
    };

    client.connect({
      useSSL: MQTT_CONFIG.useSSL,
      userName: MQTT_CONFIG.username, 
      password: MQTT_CONFIG.password, 
      timeout: 10,
      keepAliveInterval: 30,
      onSuccess: () => {
        mqttConnected = true;
        stopDummyStream();
        setConnectionStatus("connected", "Connected");
        if (dataSource) dataSource.textContent = "MQTT Cloud";
        MQTT_CONFIG.topics.forEach(topic => client.subscribe(topic));
        addLog("Terhubung ke HiveMQ Cloud! Menunggu aliran data AD8232...");
      },
      onFailure: error => {
        mqttConnected = false;
        setConnectionStatus("disconnected", "Disconnected");
        addLog("Koneksi HiveMQ Cloud gagal: " + (error.errorMessage || "Akses ditolak"));
        startDummyStream();
        setTimeout(connectMQTT, 5000);
      }
    });
  }

  recordBtn.addEventListener("click", () => {
    isRecording = !isRecording;
    if (isRecording) {
      recordedData = [["Timestamp", "Lead", "Value", "Source"]];
      recordBtn.textContent = "Berhenti & Simpan";
      if (recordStatus) recordStatus.textContent = "Recording";
      addLog("Perekaman gelombang ECG dimulai.");
    } else {
      recordBtn.textContent = "Mulai Rekam";
      if (recordStatus) recordStatus.textContent = "Standby";
      addLog("Perekaman selesai. Total entri: " + (recordedData.length - 1));
    }
  });

  exportBtn.addEventListener("click", () => {
    if (recordedData.length <= 1) {
      alert("Belum ada data rekaman!");
      return;
    }
    const csvContent = recordedData.map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ECG_Metrics_Export_" + Date.now() + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog("Ekspor file CSV berhasil diunduh.");
  });

  connectMQTT();
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "login") initLoginPage();
  if (page === "index") initIndexPage();
});