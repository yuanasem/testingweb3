// =====================================================
// REVISI SINGLE-LEAD MONITORING: HIVEMQ & VERCEL
// =====================================================

const TOKEN_KEY = "token";
const USER_KEY = "ecg_current_user";

const MQTT_CONFIG = {
  broker: "b12be20128b4431fa7257c750cb205d6.s1.eu.hivemq.cloud", 
  port: 8884,                                            
  path: "/mqtt",
  useSSL: true,
  username: "monitoring_ecg",                           
  password: "PasswordEcg123",                           
  topics: ["esp32/lead1"] // Hanya mendengarkan topik utama Lead 1 fisik
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
  const statusBadge = document.getElementById("conn-status");
  const recordLog = document.getElementById("recordLog");
  const recordBtn = document.getElementById("recordBtn");
  const exportBtn = document.getElementById("exportBtn");
  const recordStatus = document.getElementById("recordStatus");
  const dataCount = document.getElementById("dataCount");
  const dataSource = document.getElementById("dataSource");

  if (!ctxMain || typeof Chart === "undefined") return;

  let isRecording = false;
  let recordedData = [["Timestamp", "Value", "Source"]];
  let mqttConnected = false;
  let dummyInterval = null;

  const MAX_DATA_POINTS = 150; // Sedikit dinaikkan agar visualisasi komponen QRS lebih lega
  const labels = Array(MAX_DATA_POINTS).fill("");

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { grid: { display: false }, ticks: { display: false } },
      y: { suggestedMin: -200, suggestedMax: 3000, grid: { color: "rgba(230, 57, 70, 0.15)" } }
    }
  };

  const ecgChart = new Chart(ctxMain.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Lead I (Fisik)", data: [], borderColor: "#e63946", borderWidth: 2.5, pointRadius: 0, tension: 0.1 }
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

  function updateCharts(l1, source = "MQTT") {
    pushValue(ecgChart.data.datasets[0], l1);
    ecgChart.update("none");

    if (isRecording) {
      const now = new Date().toLocaleTimeString();
      recordedData.push([now, l1, source]);
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
      const base = 1000 + Math.sin(t) * 30; // Menggeser baseline ke area tengah ADC
      const pqrst = Math.exp(-Math.pow((t % 6) - 2, 2) * 20) * 1200; 
      const l1 = base + pqrst;
      updateCharts(l1, "Dummy");
    }, 60);
  }

  function stopDummyStream() {
    if (dummyInterval) {
      clearInterval(dummyInterval);
      dummyInterval = null;
    }
  }

  function connectMQTT() {
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
      if (isNaN(value)) return;
      updateCharts(value, "MQTT");
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
      recordedData = [["Timestamp", "Value", "Source"]];
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