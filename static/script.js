// ============================================================================
// 1. CONFIGURATION & GLOBAL VARIABLES
// ============================================================================
const MQTT_CONFIG = {
  server: "b12be20128b4431fa7257c750cb205d6.s1.eu.hivemq.cloud",
  port: 8884, // Port WebSockets dengan enkripsi SSL/TLS di HiveMQ Cloud
  user: "monitoring_ecg",
  password: "PasswordEcg123",
  topic: "esp32/lead1"
};

let mqttClient = null;
let mainChart = null;
let augChart = null;

// State Manajemen Perekaman Data
let isRecording = false;
let recordedData = [];
let dataCount = 0;
const MAX_CHART_POINTS = 100; // Batas jumlah titik pada layar rolling window

// ============================================================================
// 2. AUTHENTICATION & SESSION MANAGEMENT (dashboard.html & index.html)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const currentPage = document.body.getAttribute("data-page");

  if (currentPage === "login") {
    initLoginPage();
  } else if (currentPage === "index") {
    checkSession();
    initDashboardPage();
  }
});

function checkSession() {
  const session = localStorage.getItem("ecg_session");
  if (!session) {
    window.location.href = "dashboard.html";
  } else {
    setTimeout(() => {
      const welcomeText = document.getElementById("welcomeUser");
      if (welcomeText) welcomeText.innerText = `Dashboard real-time ECG (${session})`;
    }, 100);
  }
}

function initLoginPage() {
  const loginTab = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  const usernameGroup = document.getElementById("usernameGroup");
  const authTitle = document.getElementById("authTitle");
  const authBtn = document.getElementById("authBtn");
  const authForm = document.getElementById("authForm");
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("password");
  const demoLoginBtn = document.getElementById("demoLoginBtn");
  const authMessage = document.getElementById("authMessage");

  let isLoginMode = true;

  function showMessage(text, type) {
    authMessage.textContent = text;
    authMessage.className = `auth-message show ${type}`;
  }

  loginTab.addEventListener("click", () => {
    isLoginMode = true;
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    usernameGroup.classList.add("hidden");
    authTitle.innerText = "Login Dashboard";
    authBtn.innerText = "Masuk ke Index";
  });

  signupTab.addEventListener("click", () => {
    isLoginMode = false;
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    usernameGroup.classList.remove("hidden");
    authTitle.innerText = "Sign Up Akun Baru";
    authBtn.innerText = "Daftar & Masuk";
  });

  togglePassword.addEventListener("click", () => {
    if (passwordInput.type === "password") {
      passwordInput.type = "text";
      togglePassword.innerText = "Sembunyi";
    } else {
      passwordInput.type = "password";
      togglePassword.innerText = "Lihat";
    }
  });

  demoLoginBtn.addEventListener("click", () => {
    localStorage.setItem("ecg_session", "Demo Account");
    showMessage("Login Demo Sukses! Mengarahkan...", "success");
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
  });

  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = passwordInput.value;

    if (isLoginMode) {
      if ((email === "demo@ecg.com" && password === "demo123") || password.length >= 6) {
        localStorage.setItem("ecg_session", email);
        showMessage("Login Berhasil! Mengarahkan...", "success");
        setTimeout(() => { window.location.href = "index.html"; }, 1200);
      } else {
        showMessage("Email atau Password salah (Min. 6 Karakter)", "error");
      }
    } else {
      const username = document.getElementById("username").value;
      if (!username) {
        showMessage("Username wajib diisi!", "error");
        return;
      }
      localStorage.setItem("ecg_session", email);
      showMessage("Registrasi Berhasil! Mengarahkan...", "success");
      setTimeout(() => { window.location.href = "index.html"; }, 1200);
    }
  });
}

// ============================================================================
// 3. DASHBOARD MAIN CODE (index.html)
// ============================================================================
function initDashboardPage() {
  initCharts();
  connectMQTT();

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("ecg_session");
    window.location.href = "dashboard.html";
  });

  // Penanganan Tombol Perekaman Data
  const recordBtn = document.getElementById("recordBtn");
  const recordStatus = document.getElementById("recordStatus");
  recordBtn.addEventListener("click", () => {
    isRecording = !isRecording;
    if (isRecording) {
      isRecording = true;
      recordStatus.innerText = "RECORDING";
      recordBtn.innerText = "Berhenti Rekam";
      recordBtn.style.background = "var(--dark)";
      addLog("Perekaman data ECG dimulai.");
    } else {
      isRecording = false;
      recordStatus.innerText = "Standby";
      recordBtn.innerText = "Mulai Rekam";
      recordBtn.style.background = "linear-gradient(135deg, var(--red), var(--red-dark))";
      addLog(`Perekaman dihentikan. Berhasil mengunci ${recordedData.length} baris data matriks.`);
    }
  });

  // Penanganan Ekspor CSV
  document.getElementById("exportBtn").addEventListener("click", exportToCSV);
}

// ============================================================================
// 4. CHART.JS INITIALIZATION
// ============================================================================
function initCharts() {
  const ctxMain = document.getElementById("ecgChartMain").getContext("2d");
  const ctxAug = document.getElementById("ecgChartAug").getContext("2d");

  // Format array kosong awal untuk sumbu X (Label indeks gerakan)
  const dummyLabels = Array.from({ length: MAX_CHART_POINTS }, (_, i) => "");

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // Matikan animasi agar rendering data streaming 100Hz lancar & ringan
    elements: { point: { radius: 0 }, line: { tension: 0.15 } },
    scales: {
      x: { display: false },
      y: { min: 0, max: 4096, grid: { color: "rgba(0, 0, 0, 0.05)" } }
    },
    plugins: { legend: { position: "top" } }
  };

  mainChart = new Chart(ctxMain, {
    type: "line",
    data: {
      labels: dummyLabels,
      datasets: [
        { label: "Lead I (Fisik)", data: Array(MAX_CHART_POINTS).fill(2048), borderColor: "#e63946", borderWidth: 2 },
        { label: "Lead II (Simulasi)", data: Array(MAX_CHART_POINTS).fill(2048), borderColor: "#f9c74f", borderWidth: 2 },
        { label: "Lead III (Simulasi)", data: Array(MAX_CHART_POINTS).fill(2048), borderColor: "#2a9d8f", borderWidth: 2 }
      ]
    },
    options: chartOptions
  });

  // Salin opsi modifikasi skala Y khusus Augmented Leads (Sinyal terpusat)
  const augOptions = JSON.parse(JSON.stringify(chartOptions));
  augOptions.scales.y.min = -2048;
  augOptions.scales.y.max = 2048;

  augChart = new Chart(ctxAug, {
    type: "line",
    data: {
      labels: dummyLabels,
      datasets: [
        { label: "aVR", data: Array(MAX_CHART_POINTS).fill(0), borderColor: "#2563eb", borderWidth: 1.5 },
        { label: "aVL", data: Array(MAX_CHART_POINTS).fill(0), borderColor: "#8b5cf6", borderWidth: 1.5 },
        { label: "aVF", data: Array(MAX_CHART_POINTS).fill(0), borderColor: "#ec4899", borderWidth: 1.5 }
      ]
    },
    options: augOptions
  });
}

// ============================================================================
// 5. MQTT COMMUNICATION via PAHO MQTT
// ============================================================================
function connectMQTT() {
  const statusBadge = document.getElementById("conn-status");
  const clientId = "Web_Dashboard_" + Math.random().toString(16).substr(2, 8);

  mqttClient = new Paho.MQTT.Client(MQTT_CONFIG.server, Number(MQTT_CONFIG.port), clientId);

  mqttClient.onConnectionLost = (responseObject) => {
    statusBadge.innerText = "Disconnected";
    statusBadge.className = "status-badge disconnected";
    addLog(`[ERROR] Koneksi MQTT Terputus: ${responseObject.errorMessage}. Mencoba menyambung kembali...`);
    setTimeout(connectMQTT, 5000);
  };

  mqttClient.onMessageArrived = (message) => {
    if (message.destinationName === MQTT_CONFIG.topic) {
      processECGData(parseInt(message.payloadString));
    }
  };

  const connectOptions = {
    useSSL: true,
    userName: MQTT_CONFIG.user,
    password: MQTT_CONFIG.password,
    onSuccess: () => {
      statusBadge.innerText = "Connected";
      statusBadge.className = "status-badge connected";
      addLog("Berhasil terhubung ke Broker HiveMQ Cloud!");
      mqttClient.subscribe(MQTT_CONFIG.topic);
      addLog(`Subscribed ke topik: ${MQTT_CONFIG.topic}`);
    },
    onFailure: (err) => {
      statusBadge.innerText = "Error Conn";
      statusBadge.className = "status-badge disconnected";
      addLog(`[ERROR] Gagal menyambung ke broker MQTT: ${err.errorMessage}`);
      setTimeout(connectMQTT, 5000);
    }
  };

  mqttClient.connect(connectOptions);
}

// ============================================================================
// 6. REVISI LOGIKA MATEMATIKA KALKULASI MULTI-LEADS (PASCA-PEMROSESAN)
// ============================================================================
function processECGData(leadI) {
  let leadII = 0;
  let leadIII = 0;
  let aVR = 0;
  let aVL = 0;
  let aVF = 0;

  // JIKA SENSOR LEPAS (Firmware mengirimkan nilai 0)
  if (leadI <= 0) {
    // Semua dipaksa flatline pada garis baseline masing-masing
    leadI = 0;
    leadII = 0;
    leadIII = 0;
    aVR = 0;
    aVL = 0;
    aVF = 0;
  } 
  // JIKA DATA VALID (Suku sinyal hidup terdeteksi)
  else {
    // 1. Ekstrak komponen AC (hilangkan offset tegangan DC 2048 agar gelombang murni di sumbu 0)
    let leadI_ac = leadI - 2048;

    // 2. SIMULASI MEDIS JANTUNG: Bentuk gelombang Lead II tiruan yang sinkron dengan Lead I.
    // Kita berikan pengali amplitudo 1.25x dan pergeseran fasa fisiologis menggunakan fungsi waktu linear
    let waveShift = Math.sin(Date.now() / 140) * 110;
    let leadII_ac = Math.round(leadI_ac * 1.25 + waveShift);

    // 3. SEGITIGA EINTHOVEN HUKUM ASLI: Lead III = Lead II - Lead I
    let leadIII_ac = leadII_ac - leadI_ac;

    // Kembalikan ke format biner ADC (Bawa kembali ke offset 2048)
    leadII = 2048 + leadII_ac;
    leadIII = 2048 + leadIII_ac;

    // Batasi jangkauan pengaman output grafik agar tidak menembus batas canvas (0 - 4095)
    leadII = Math.max(0, Math.min(4095, leadII));
    leadIII = Math.max(0, Math.min(4095, leadIII));

    // 4. PERSAMAAN GOLDBERGER (Hukum Asli Elektroda untuk Augmented Leads)
    aVR = Math.round(-(leadI_ac + leadII_ac) / 2);
    aVL = Math.round((leadI_ac - leadIII_ac) / 2);
    aVF = Math.round((leadII_ac + leadIII_ac) / 2);
  }

  // --- UPDATE GRAFIK SECARA REAL-TIME ---
  // Geser Data Grafik Utama (Leads I, II, III)
  mainChart.data.datasets[0].data.push(leadI);
  mainChart.data.datasets[1].data.push(leadII);
  mainChart.data.datasets[2].data.push(leadIII);

  mainChart.data.datasets[0].data.shift();
  mainChart.data.datasets[1].data.shift();
  mainChart.data.datasets[2].data.shift();
  mainChart.update();

  // Geser Data Grafik Kedua (Augmented Leads)
  augChart.data.datasets[0].data.push(aVR);
  augChart.data.datasets[1].data.push(aVL);
  augChart.data.datasets[2].data.push(aVF);

  augChart.data.datasets[0].data.shift();
  augChart.data.datasets[1].data.shift();
  augChart.data.datasets[2].data.shift();
  augChart.update();

  // --- LOGIKA RECORD DATA DAN COUNTER METRIKS ---
  dataCount++;
  document.getElementById("dataCount").innerText = dataCount;

  if (isRecording) {
    const timestampStr = new Date().toLocaleTimeString();
    recordedData.push({ Timestamp: timestampStr, Lead: "Lead I", Value: leadI, Source: "MQTT" });
    recordedData.push({ Timestamp: timestampStr, Lead: "Lead II", Value: leadII, Source: "Simulasi" });
    recordedData.push({ Timestamp: timestampStr, Lead: "Lead III", Value: leadIII, Source: "Simulasi" });
  }
}

// ============================================================================
// 7. EXPORT DATA TO CSV (EXCEL READABLE)
// ============================================================================
function exportToCSV() {
  if (recordedData.length === 0) {
    alert("Belum ada data yang direkam! Klik tombol 'Mulai Rekam' terlebih dahulu.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,Timestamp,Lead,Value,Source\n";

  recordedData.forEach((row) => {
    csvContent += `${row.Timestamp},${row.Lead},${row.Value},${row.Source}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", encodedUri);
  downloadAnchor.setAttribute("download", `ECG_Metrics_Export_${Date.now()}.csv`);
  document.body.appendChild(downloadAnchor);

  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);
  addLog(`Sukses mengekspor ${recordedData.length} baris ke file Excel CSV.`);
}

// ============================================================================
// 8. LOG UTILITY FUNCTION
// ============================================================================
function addLog(message) {
  const logContainer = document.getElementById("recordLog");
  if (!logContainer) return;

  const time = new Date().toLocaleTimeString();
  const logElement = document.createElement("p");
  logElement.innerHTML = `[${time}] ${message}`;

  // Masukkan log baru di bagian paling atas kontainer agar mudah dibaca
  logContainer.insertBefore(logElement, logContainer.firstChild);
}