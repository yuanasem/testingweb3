// =====================================================
// REVISI TOTAL KONEKTIVITAS & BYPASS BLOCKING LOGOUT
// =====================================================

const TOKEN_KEY = "token";
const USER_KEY = "ecg_current_user";

const MQTT_CONFIG = {
  broker: "b12be20128b4431fa7257c750cb205d6.s1.eu.hivemq.cloud",
  port: 8884,
  path: "/mqtt",
  useSSL: true
};

// Fungsi Log Aktivitas Mandiri ke Database Backend Vercel
async function pushAuditLog(action, details) {
  const token = localStorage.getItem(TOKEN_KEY);
  // OPTIMASI: Langsung abaikan jika tidak ada token atau jika menggunakan akun demo
  if (!token || token === "demo-token") return; 
  try {
    await fetch("/api/log/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ action, details })
    });
  } catch (err) { console.log("Gagal sinkronisasi log cloud."); }
}

// ==========================================
// CONTROL UTAMA: ROUTING DINAMIS SATU FILE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  const token = localStorage.getItem(TOKEN_KEY);
  const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");

  if (page === "login") {
    if (token && user) {
      window.location.href = "index.html"; 
    } else { initLoginPage(); }
  } else if (page === "index") {
    if (!token || !user) { 
      window.location.href = "dashboard.html"; 
      return; 
    }
    
    // EKSEKUSI PEMILAHAN VIEW BERDASARKAN ROLE
    if (user.role === "admin") {
      document.getElementById("admin-view").classList.remove("hidden");
      initAdminPage(token, user);
    } else {
      document.getElementById("user-view").classList.remove("hidden");
      initIndexPage(token, user);
    }
  }
});

// ==========================================
// 1. HALAMAN LOGIN & DAFTAR (dashboard.html)
// ==========================================
function initLoginPage() {
  const authForm = document.getElementById("authForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const usernameInput = document.getElementById("username");
  const authTitle = document.getElementById("authTitle");
  const authBtn = document.getElementById("authBtn");
  const loginTab = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  const usernameGroup = document.getElementById("usernameGroup");
  const demoLoginBtn = document.getElementById("demoLoginBtn");

  let isLoginMode = true;

  loginTab.addEventListener("click", () => {
    isLoginMode = true;
    loginTab.classList.add("active"); signupTab.classList.remove("active");
    usernameGroup.classList.add("hidden"); authTitle.textContent = "Login Dashboard"; authBtn.textContent = "Masuk ke Index";
  });

  signupTab.addEventListener("click", () => {
    isLoginMode = false;
    signupTab.classList.add("active"); loginTab.classList.remove("active");
    usernameGroup.classList.remove("hidden"); authTitle.textContent = "Sign Up Akun"; authBtn.textContent = "Daftar Akun";
  });

  demoLoginBtn.addEventListener("click", () => {
    localStorage.setItem(TOKEN_KEY, "demo-token");
    localStorage.setItem(USER_KEY, JSON.stringify({ username: "Demo Guest", email: "demo@ecg.com", role: "user", pairedDeviceId: "DEMO-DEV" }));
    window.location.href = "index.html";
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const endpoint = isLoginMode ? "/api/login" : "/api/signup";
    const payload = isLoginMode ? 
      { email: emailInput.value, password: passwordInput.value } : 
      { username: usernameInput.value, email: emailInput.value, password: passwordInput.value };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error || "Gagal autentikasi."); return; }

      if (isLoginMode) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        window.location.href = "index.html";
      } else {
        alert("Akun sukses didaftarkan! Silakan masuk via tab login.");
        loginTab.click();
      }
    } catch (err) { alert("Terjadi gangguan koneksi ke server."); }
  });
}

// ==========================================
// 2. LOGIKA VIEW: DASHBOARD PASIEN
// ==========================================
function initIndexPage(token, user) {
  document.getElementById("welcomeUser").textContent = "Selamat datang, " + user.username;
  document.getElementById("userRole").textContent = user.role.toUpperCase();
  document.getElementById("boundDevice").textContent = user.pairedDeviceId || "None (Unpaired)";
  
  // REVISI KRUSIAL: Menghapus await agar eksekusi pembersihan sesi bersifat instan (anti-freeze)
  document.querySelector("#user-view .logoutBtn").addEventListener("click", () => {
    pushAuditLog('LOGOUT', `${user.username} keluar dari sistem website.`);
    localStorage.clear(); 
    window.location.href = "dashboard.html";
  });

  const ctxMain = document.getElementById("ecgChartMain");
  const statusBadge = document.getElementById("conn-status");
  const recordLog = document.getElementById("recordLog");
  const recordBtn = document.getElementById("recordBtn");
  const exportBtn = document.getElementById("exportBtn");
  const recordStatus = document.getElementById("recordStatus");
  const dataCount = document.getElementById("dataCount");

  let isRecording = false;
  let recordedData = [["Timestamp", "ECG Value"]];
  let dummyInterval = null;
  const MAX_POINTS = 150;

  const ecgChart = new Chart(ctxMain.getContext("2d"), {
    type: "line",
    data: { labels: Array(MAX_POINTS).fill(""), datasets: [{ label: "Lead I (Fisik)", data: [], borderColor: "#e63946", borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { display: false }, y: { suggestedMin: -200, suggestedMax: 3000 } } }
  });

  function addLog(msg) {
    const p = document.createElement("p"); p.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    recordLog.prepend(p);
  }

  function updateDataGrid(value, source) {
    ecgChart.data.datasets[0].data.push(value);
    if (ecgChart.data.datasets[0].data.length > MAX_POINTS) ecgChart.data.datasets[0].data.shift();
    ecgChart.update("none");

    if (isRecording) {
      recordedData.push([new Date().toLocaleTimeString(), value]);
      dataCount.textContent = String(recordedData.length - 1);
    }
  }

  function startDummy() {
    if (dummyInterval) return;
    statusBadge.className = "status-badge demo"; statusBadge.textContent = "Demo Mode";
    addLog("Mengaktifkan dummy stream (Gagal membaca Device ID).");
    let t = 0;
    dummyInterval = setInterval(() => {
      t += 0.2;
      const val = 1000 + Math.sin(t)*30 + (Math.exp(-Math.pow((t % 6) - 2, 2) * 20) * 1200);
      updateDataGrid(val, "Dummy");
    }, 60);
  }

  if (!user.pairedDeviceId || user.pairedDeviceId === "DEMO-DEV") { startDummy(); } 
  else {
    statusBadge.className = "status-badge connecting"; statusBadge.textContent = "Connecting...";
    const clientID = "web_user_" + Math.random().toString(16).slice(2, 6);
    const client = new Paho.MQTT.Client(MQTT_CONFIG.broker, Number(MQTT_CONFIG.port), MQTT_CONFIG.path, clientID);

    client.onConnectionLost = () => {
      statusBadge.className = "status-badge disconnected"; statusBadge.textContent = "Disconnected";
      startDummy();
    };

    client.onMessageArrived = (msg) => {
      const val = Number(msg.payloadString);
      if (!isNaN(val)) updateDataGrid(val, "MQTT");
    };

    client.connect({
      useSSL: true, userName: "monitoring_ecg", password: "PasswordEcg123", timeout: 10,
      onSuccess: () => {
        if (dummyInterval) { clearInterval(dummyInterval); dummyInterval = null; }
        statusBadge.className = "status-badge connected"; statusBadge.textContent = "Connected";
        const topicTarget = `esp32/${user.pairedDeviceId}/lead1`;
        client.subscribe(topicTarget);
        addLog(`Sukses tersambung ke perangkat via topik: ${topicTarget}`);
        pushAuditLog('STORING_DATA', `${user.username} mulai melakukan visualisasi data dari device ID: ${user.pairedDeviceId}`);
      },
      onFailure: () => { startDummy(); }
    });
  }

  recordBtn.addEventListener("click", () => {
    isRecording = !isRecording;
    if (isRecording) {
      recordedData = [["Timestamp", "ECG Value"]]; recordBtn.textContent = "Berhenti & Simpan";
      recordStatus.textContent = "Recording"; addLog("Perekaman dimulai.");
    } else {
      recordBtn.textContent = "Mulai Rekam"; recordStatus.textContent = "Standby";
      addLog("Perekaman selesai. Total entri: " + (recordedData.length - 1));
    }
  });

  exportBtn.addEventListener("click", () => {
    if (recordedData.length <= 1) { alert("Belum ada data rekaman!"); return; }
    const csvContent = recordedData.map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `ECG_Data_${user.username}_${Date.now()}.csv`;
    link.click(); URL.revokeObjectURL(url);
    addLog("File rekaman CSV berhasil diunduh.");
    pushAuditLog('DOWNLOAD_DATA', `${user.username} mengunduh data rekaman medis (CSV) ke penyimpanan lokal.`);
  });
}

// ==========================================
// 3. LOGIKA VIEW: PANEL KONTROL ADMIN
// ==========================================
function initAdminPage(token, user) {
  // REVISI KRUSIAL: Menghapus await pada tombol logout admin agar pembersihan instan
  document.querySelector("#admin-view .logoutBtn").addEventListener("click", () => {
    localStorage.clear(); 
    window.location.href = "dashboard.html";
  });

  async function loadAdminLogs() {
    try {
      const res = await fetch("/api/admin/logs", { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      const container = document.getElementById("adminLogContainer");
      if (data.success && data.logs.length > 0) {
        container.innerHTML = data.logs.map(log => {
          let badgeColor = log.action === 'LOGIN' ? '#22c55e' : log.action === 'DOWNLOAD_DATA' ? '#eab308' : '#38bdf8';
          return `<p style="margin-bottom:8px; border-bottom:1px solid #334155; padding-bottom:4px;">
            <span style="color:#94a3b8">[${new Date(log.timestamp).toLocaleTimeString()}]</span> 
            <b style="color:${badgeColor}">[${log.action}]</b> 
            <span style="color:#f8fafc">${log.details}</span> 
            <i style="color:#64748b; font-size:11px;">(${log.email})</i>
          </p>`;
        }).join("");
      } else { container.innerHTML = "<p>Belum ada rekaman log aktivitas hari ini.</p>"; }
    } catch (err) { console.log("Gagal memuat log."); }
  }

  async function loadUsersGrid() {
    try {
      const res = await fetch("/api/admin/users", { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      const tbody = document.getElementById("usersTableBody");
      if (data.success && data.users.length > 0) {
        tbody.innerHTML = data.users.map(u => {
          if (u.role === 'admin') return ''; 
          return `<tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding:12px;"><b>${u.username}</b></td>
            <td style="padding:12px;">${u.email}</td>
            <td style="padding:12px;"><span class="status-badge connected" style="background:#64748b;">${u.role.toUpperCase()}</span></td>
            <td style="padding:12px;"><input type="text" id="dev_${u._id}" value="${u.pairedDeviceId || ''}" placeholder="Contoh: ESP32-DEV-01" style="padding:6px; border:1px solid #94a3b8; border-radius:4px; font-weight:bold;"></td>
            <td style="padding:12px;"><button onclick="savePairing('${u._id}')" class="btn-record" style="padding:6px 12px; font-size:12px; background:#7c3aed;">Update Link</button></td>
          </tr>`;
        }).join("");
      }
    } catch (err) { console.log("Gagal memuat grid user."); }
  }

  window.savePairing = async function(userId) {
    const deviceIdValue = document.getElementById(`dev_${userId}`).value.trim();
    try {
      const res = await fetch("/api/admin/pair-device", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ userId, deviceId: deviceIdValue })
      });
      const data = await res.json();
      if (data.success) { alert("Tautan Device ID berhasil diupdate!"); loadUsersGrid(); loadAdminLogs(); }
    } catch (err) { alert("Gagal memperbarui tautan perangkat."); }
  };

  loadAdminLogs(); loadUsersGrid();
  setInterval(loadAdminLogs, 10000);
}