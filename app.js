/**
 * SmartCal Linker - יומן חכם (קובץ לוגיקה ראשי)
 * מיועד להמרת קלט מולטימודלי (טקסט, תמונה, PDF, קול) לקישור יומן גוגל וקובץ ICS
 */

// --- 1. הגדרות וחשבונות ידועים (תובנות 2יומן מול משתמש חיצוני חדש) ---
const DEFAULT_ACCOUNTS = [
  { 
    id: 'dim', 
    name: 'דים (אישי)', 
    email: 'dymvie@gmail.com', 
    isGroup: false 
  },
  { 
    id: 'danny', 
    name: 'דני', 
    email: 'dannyonnat@gmail.com', 
    isGroup: false 
  },
  { 
    id: 'daniel', 
    name: 'דניאל', 
    email: 'yehoshafat.daniel@gmail.com', 
    isGroup: false 
  },
  { 
    id: 'work', 
    name: 'החשבייה (עבודה)', 
    email: 'yonnat@hashavia.co.il', 
    isGroup: false 
  },
  { 
    id: 'family', 
    name: 'משפחה', 
    email: 'dymvie@gmail.com', 
    isGroup: true, 
    groupEmails: 'dannyonnat@gmail.com,yehoshafat.daniel@gmail.com,dyinyy@gmail.com' 
  }
];

// פרופיל התחלתי נקי למשתמש חיצוני חדש (למניעת חשיפת כתובות המייל המשפחתיות למשתמשים זרים)
const PUBLIC_DEFAULT_ACCOUNTS = [
  {
    id: 'personal',
    name: 'היומן האישי שלי',
    email: '',
    isGroup: false
  }
];

function getStoredAccounts() {
  try {
    const raw = localStorage.getItem('smartcal_accounts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}

  // בסביבת פיתוח מקומית או אם כבר קיים מפתח של בעל המערכת, נטען את יומני 2יומן; אחרת פרופיל נקי למשתמש חדש
  const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const initialAccounts = isLocalHost ? DEFAULT_ACCOUNTS : PUBLIC_DEFAULT_ACCOUNTS;
  localStorage.setItem('smartcal_accounts', JSON.stringify(initialAccounts));
  return [...initialAccounts];
}

function saveStoredAccounts(accounts) {
  localStorage.setItem('smartcal_accounts', JSON.stringify(accounts));
}

// איפוס ושדרוג אוטומטי למודל העדכני של גוגל (Gemini 3.8 Flash)
try {
  const currentSaved = localStorage.getItem('smartcal_model');
  if (!currentSaved || currentSaved.includes('2.5') || currentSaved.includes('1.5') || currentSaved.includes('2.0')) {
    localStorage.setItem('smartcal_model', 'gemini-3.8-flash');
    console.log('SmartCal: Upgraded model to gemini-3.8-flash');
  }
} catch (e) {}

// משתני מצב מקומיים (State)
let currentAccountKey = localStorage.getItem('smartcal_account') || 'dim';
let currentActiveTab = 'text';
let imageBase64Data = null; // { data: string, mimeType: string }
let pdfBase64Data = null;   // { data: string, mimeType: string, name: string, size: string }
let audioBase64Data = null; // { data: string, mimeType: string }

// מעקב חכם אחר ייצוא/שמירה ומניעת אובדן נתונים
let hasExported = false;
let lastClearedState = null;

// משתני הקלטה קולית
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;

// נתוני האירועים שחולצו (תמיכה באירוע בודד ובריבוי אירועים - Multi-Event Batch)
let currentParsedEvent = null;
let parsedEventsList = [];
let currentEventIndex = 0;

// --- 2. אתחול האפליקציה בטעינה ---
document.addEventListener('DOMContentLoaded', () => {
  // אתחול אייקונים של Lucide
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // ביטול Service Worker רק בריצה על localhost לפיתוח נקי
  if ('serviceWorker' in navigator && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }

  // בדיקה וטעינה של קישור סנכרון מהיר למובייל (#setup=...)
  checkMagicSetupHash();

  // שחזור הגדרות שמורות
  loadSavedSettings();

  // קישור אירועים ל-UI
  setupAccountSelector();
  setupTabs();
  setupTextActions();
  setupImageActions();
  setupPdfActions();
  setupVoiceActions();
  setupFormChangeListeners();
  setupOutlookAction();
  setupHistoryModal();
  setupSettingsModal();
  setupOnboardingAndHelpModals();
  setupPwaInstallAndGlobalPaste();

  // קליטת תוכן ששותף מהנייד באמצעות Web Share Target (?text=...&url=...)
  checkSharedIncomingContent();
});

// --- 3. ניהול סרגל החשבונות הדינמי של 2יומן ---
function setupAccountSelector() {
  renderAccountButtons();
}

function formatShortEmailTag(acc) {
  if (!acc || !acc.email) return '';
  const parts = acc.email.trim().split('@');
  const user = parts[0];
  const domain = parts[1] || '';
  const baseTag = (domain && !domain.toLowerCase().startsWith('gmail.'))
    ? `${user}@${domain.split('.')[0]}`
    : `${user}@`;

  if (acc.isGroup && acc.groupEmails) {
    const count = acc.groupEmails.split(',').map(s => s.trim()).filter(Boolean).length;
    return count > 0 ? `${baseTag} +${count}` : baseTag;
  }
  return baseTag;
}

function renderAccountButtons() {
  const container = document.getElementById('accountButtonsContainer');
  const label = document.getElementById('selectedAccountLabel');
  if (!container) return;

  const accounts = getStoredAccounts();
  if (!accounts.some(a => a.id === currentAccountKey)) {
    currentAccountKey = accounts[0]?.id || 'dim';
    localStorage.setItem('smartcal_account', currentAccountKey);
  }

  container.innerHTML = '';
  accounts.forEach(acc => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.account = acc.id;
    const isSelected = acc.id === currentAccountKey;
    if (isSelected) {
      btn.className = 'account-btn active px-2.5 py-1.5 rounded-xl border border-blue-600 bg-blue-50 text-blue-700 font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 shadow-xs shrink-0 text-xs';
    } else {
      btn.className = 'account-btn px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 text-xs';
    }

    const iconSvg = acc.isGroup 
      ? `<i data-lucide="users" class="w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-gray-400'} shrink-0"></i>` 
      : `<i data-lucide="user" class="w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-gray-400'} shrink-0"></i>`;

    const shortEmail = formatShortEmailTag(acc);
    const emailChip = shortEmail
      ? `<bdi dir="ltr" class="text-[10px] font-mono px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-blue-100/90 text-blue-800' : 'bg-gray-100 text-gray-500'}">${shortEmail}</bdi>`
      : '';

    btn.title = acc.isGroup && acc.groupEmails
      ? `${acc.name} (${acc.email}) • מוזמנים: ${acc.groupEmails}`
      : `${acc.name} (${acc.email || ''})`;

    btn.innerHTML = `${iconSvg}<span>${acc.name}</span>${emailChip}`;

    btn.addEventListener('click', () => {
      currentAccountKey = acc.id;
      localStorage.setItem('smartcal_account', acc.id);
      renderAccountButtons();
      if (currentParsedEvent) {
        refreshCalendarLinks();
      }
    });

    container.appendChild(btn);
  });

  const activeAcc = accounts.find(a => a.id === currentAccountKey) || accounts[0];
  if (label && activeAcc) {
    const groupCount = (activeAcc.isGroup && activeAcc.groupEmails)
      ? activeAcc.groupEmails.split(',').map(s => s.trim()).filter(Boolean).length
      : 0;
    const groupBadge = groupCount > 0
      ? `<span class="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-md font-semibold">+${groupCount} מוזמנים</span>`
      : '';
    const emailBadge = activeAcc.email
      ? `<bdi dir="ltr" class="font-mono text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200 font-semibold">${activeAcc.email}</bdi>`
      : `<span class="text-[11px] text-gray-500">(יומן ברירת המחדל בדפדפן)</span>`;

    label.innerHTML = `
      <span class="inline-flex items-center gap-1.5 flex-wrap justify-end">
        <span class="font-bold text-gray-800">${activeAcc.name}</span>
        ${emailBadge}
        ${groupBadge}
      </span>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

// --- 4. מעבר בין טאבים (טקסט, תמונה, PDF, קול) ---
function setupTabs() {
  const tabs = {
    text: { btn: document.getElementById('tabText'), panel: document.getElementById('panelText') },
    image: { btn: document.getElementById('tabImage'), panel: document.getElementById('panelImage') },
    pdf: { btn: document.getElementById('tabPdf'), panel: document.getElementById('panelPdf') },
    voice: { btn: document.getElementById('tabVoice'), panel: document.getElementById('panelVoice') }
  };

  Object.keys(tabs).forEach(tabKey => {
    const { btn, panel } = tabs[tabKey];
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      currentActiveTab = tabKey;
      Object.keys(tabs).forEach(k => {
        const t = tabs[k];
        if (k === tabKey) {
          t.btn.classList.add('active', 'text-blue-700', 'bg-white', 'shadow-xs');
          t.btn.classList.remove('text-gray-600');
          t.panel.classList.remove('hidden');
        } else {
          t.btn.classList.remove('active', 'text-blue-700', 'bg-white', 'shadow-xs');
          t.btn.classList.add('text-gray-600');
          t.panel.classList.add('hidden');
        }
      });
    });
  });
}

// --- 5. פעולות לשונית טקסט ---
function setupTextActions() {
  const textInput = document.getElementById('textInput');
  const pasteBtn = document.getElementById('pasteClipboardBtn');
  const clearBtn = document.getElementById('clearTextBtn');
  const parseBtn = document.getElementById('parseEventBtn');

  if (pasteBtn && textInput) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          textInput.value = text;
          showToast('התוכן הודבק מהלוח בהצלחה', 'check');
        } else {
          showToast('הלוח ריק', 'info');
        }
      } catch (err) {
        showToast('יש לאשר גישה ללוח הגזירים בדפדפן', 'alert-circle');
      }
    });
  }

  if (clearBtn && textInput) {
    clearBtn.addEventListener('click', () => {
      textInput.value = '';
      textInput.style.height = 'auto';
      textInput.focus();
    });
  }

  if (textInput) {
    textInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleParseRequest();
      }
    });
  }

  if (parseBtn) {
    parseBtn.addEventListener('click', handleParseRequest);
  }
}

// --- 6. פעולות לשונית תמונה / פלייר ---
function setupImageActions() {
  const dropZone = document.getElementById('imageDropZone');
  const fileInput = document.getElementById('imageFileInput');
  const placeholder = document.getElementById('imagePlaceholder');
  const previewContainer = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreview');
  const removeBtn = document.getElementById('removeImageBtn');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('#removeImageBtn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-emerald-500', 'bg-emerald-50/30');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-emerald-500', 'bg-emerald-50/30');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-emerald-500', 'bg-emerald-50/30');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      imageBase64Data = null;
      fileInput.value = '';
      previewContainer.classList.add('hidden');
      placeholder.classList.remove('hidden');
    });
  }

  function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('נא לבחור קובץ תמונה (JPG, PNG וכד\')', 'alert-circle');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target.result;
      const base64Clean = result.split(',')[1];
      imageBase64Data = {
        data: base64Clean,
        mimeType: file.type
      };
      previewImg.src = result;
      placeholder.classList.add('hidden');
      previewContainer.classList.remove('hidden');
      showToast('תמונה נטענה בהצלחה', 'check');
    };
    reader.readAsDataURL(file);
  }
}

// --- 7. פעולות לשונית PDF ---
function setupPdfActions() {
  const dropZone = document.getElementById('pdfDropZone');
  const fileInput = document.getElementById('pdfFileInput');
  const placeholder = document.getElementById('pdfPlaceholder');
  const infoContainer = document.getElementById('pdfInfoContainer');
  const fileNameEl = document.getElementById('pdfFileName');
  const fileSizeEl = document.getElementById('pdfFileSize');
  const removeBtn = document.getElementById('removePdfBtn');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('#removePdfBtn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handlePdfFile(file);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-amber-500', 'bg-amber-50/30');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-amber-500', 'bg-amber-50/30');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-amber-500', 'bg-amber-50/30');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handlePdfFile(e.dataTransfer.files[0]);
    }
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pdfBase64Data = null;
      fileInput.value = '';
      infoContainer.classList.add('hidden');
      placeholder.classList.remove('hidden');
    });
  }

  function handlePdfFile(file) {
    if (file.type !== 'application/pdf') {
      showToast('נא לבחור קובץ מסוג PDF', 'alert-circle');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target.result;
      const base64Clean = result.split(',')[1];
      pdfBase64Data = {
        data: base64Clean,
        mimeType: 'application/pdf',
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      };
      fileNameEl.textContent = file.name;
      fileSizeEl.textContent = pdfBase64Data.size;
      placeholder.classList.add('hidden');
      infoContainer.classList.remove('hidden');
      showToast('קובץ PDF נטען בהצלחה', 'check');
    };
    reader.readAsDataURL(file);
  }
}

// --- 8. פעולות לשונית הקלטה קולית ---
function setupVoiceActions() {
  const micBtn = document.getElementById('micRecordBtn');
  const timerEl = document.getElementById('recordingTimer');
  const statusEl = document.getElementById('voiceStatusText');
  const audioContainer = document.getElementById('audioPlaybackContainer');
  const audioPreview = document.getElementById('audioPreview');
  const removeAudioBtn = document.getElementById('removeAudioBtn');

  if (!micBtn) return;

  let isRecording = false;

  micBtn.addEventListener('click', async () => {
    if (!isRecording) {
      // התחלת הקלטה
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        
        // בחירת פורמט נתמך
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        }

        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const finalMime = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunks, { type: finalMime });
          const audioUrl = URL.createObjectURL(audioBlob);
          audioPreview.src = audioUrl;
          audioContainer.classList.remove('hidden');

          // המרה ל-Base64 עבור Gemini
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Clean = reader.result.split(',')[1];
            audioBase64Data = {
              data: base64Clean,
              mimeType: finalMime.split(';')[0] // הסרת codec נלווה
            };
            showToast('ההקלטה הושלמה ומוכנה לניתוח', 'check');
          };
          reader.readAsDataURL(audioBlob);

          // שחרור המיקרופון
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        recordingSeconds = 0;
        timerEl.textContent = '00:00';
        timerEl.classList.remove('hidden');
        micBtn.classList.add('recording-pulse', 'bg-red-600', 'text-white', 'border-red-600');
        statusEl.textContent = 'מקליט... דבר בטבעיות (לסיום לחץ שוב)';

        recordingInterval = setInterval(() => {
          recordingSeconds++;
          const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
          const secs = String(recordingSeconds % 60).padStart(2, '0');
          timerEl.textContent = `${mins}:${secs}`;
        }, 1000);

      } catch (err) {
        console.error('שגיאה בגישה למיקרופון:', err);
        showToast('לא ניתן לגשת למיקרופון. אנא ודא שניתנה הרשאה.', 'alert-circle');
      }
    } else {
      // עצירת הקלטה
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      clearInterval(recordingInterval);
      isRecording = false;
      micBtn.classList.remove('recording-pulse', 'bg-red-600', 'text-white', 'border-red-600');
      statusEl.textContent = 'ההקלטה נקלטה בהצלחה!';
    }
  });

  if (removeAudioBtn) {
    removeAudioBtn.addEventListener('click', () => {
      audioBase64Data = null;
      audioPreview.src = '';
      audioContainer.classList.add('hidden');
      timerEl.classList.add('hidden');
      statusEl.textContent = 'לחץ על המיקרופון והקלט את האירוע';
    });
  }
}

// --- 9. מנוע ניתוח ה-AI (Gemini Integration) ---
async function handleParseRequest() {
  const apiKey = getApiKey();
  if (!apiKey) {
    showToast('כדי לחלץ אירועים, הגדר מפתח Gemini API אישי וחינמי (30 שניות)', 'info');
    openOnboardingModal();
    return;
  }

  // איסוף תוכן לפי הטאב הפעיל
  let requestParts = [];

  if (currentActiveTab === 'text') {
    const textVal = document.getElementById('textInput').value.trim();
    if (!textVal) {
      showToast('נא להזין טקסט, הודעה או קישור', 'alert-circle');
      return;
    }

    // בדיקה האם הטקסט מכיל קישור לאתר אינטרנט (URL)
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`]+)/i;
    const urlMatch = textVal.match(urlRegex);
    let extractedWebpageContent = '';

    if (urlMatch) {
      let rawUrl = urlMatch[0];
      // ניקוי סימני פיסוק מקריים בסוף הקישור (כמו נקודה, פסיק או סוגר סוגריים)
      rawUrl = rawUrl.replace(/[.,)\]>]+$/, '');

      setLoadingMessage('ניגש לקישור וקורא את תוכן דף האירוע...', `שולף מידע מתוך: ${rawUrl.substring(0, 45)}...`);
      setLoadingState(true);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000); // 9 שניות פסק זמן

        // קריאה באמצעות Jina Reader לעקיפת CORS וחילוץ תוכן נקי ב-Markdown
        const jinaUrl = `https://r.jina.ai/${rawUrl}`;
        const webResponse = await fetch(jinaUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (webResponse.ok) {
          const webMarkdown = await webResponse.text();
          if (webMarkdown && webMarkdown.trim().length > 40) {
            // שמירת עד 8,000 תווים ראשונים של תוכן הדף כדי לקבל את כל פרטי האירוע
            extractedWebpageContent = `\n\n--- תוכן שחולץ אוטומטית מדף האינטרנט (${rawUrl}) ---\n${webMarkdown.slice(0, 8000)}`;
            showToast('תוכן דף האירוע נקרא בהצלחה מהאינטרנט', 'check');
          }
        }
      } catch (webErr) {
        console.warn('שליפת הקישור לא הצליחה או עברה פסק זמן, נמשיך עם הכתובת והטקסט שהוזן:', webErr);
      }
    }

    setLoadingMessage('מנתח את תוכן האירוע באמצעות AI...', 'מחלץ תאריכים, שעות, מיקום ומנרמל ליומן');
    requestParts.push({ text: `תוכן האירוע שהוזן:\n${textVal}${extractedWebpageContent}` });
  } else if (currentActiveTab === 'image') {
    if (!imageBase64Data) {
      showToast('נא להעלות או לצלם תמונה תחילה', 'alert-circle');
      return;
    }
    requestParts.push({
      inlineData: {
        mimeType: imageBase64Data.mimeType,
        data: imageBase64Data.data
      }
    });
    requestParts.push({ text: "חלץ את פרטי האירוע מתוך תמונת הפלייר או ההזמנה." });
  } else if (currentActiveTab === 'pdf') {
    if (!pdfBase64Data) {
      showToast('נא לבחור קובץ PDF תחילה', 'alert-circle');
      return;
    }
    requestParts.push({
      inlineData: {
        mimeType: pdfBase64Data.mimeType,
        data: pdfBase64Data.data
      }
    });
    requestParts.push({ text: "חלץ את פרטי האירוע, הטיסה או הכנס מתוך קובץ ה-PDF המצורף." });
  } else if (currentActiveTab === 'voice') {
    if (!audioBase64Data) {
      showToast('נא להקליט הודעה קולית תחילה', 'alert-circle');
      return;
    }
    requestParts.push({
      inlineData: {
        mimeType: audioBase64Data.mimeType,
        data: audioBase64Data.data
      }
    });
    requestParts.push({ text: "תמלל וחלץ את פרטי האירוע מתוך ההקלטה הקולית." });
  }

  // הצגת מצב טעינה
  setLoadingState(true);

  try {
    const result = await callGeminiApi(requestParts, apiKey);
    const eventsArr = Array.isArray(result?.events) && result.events.length > 0
      ? result.events
      : (result?.title ? [result] : []);

    if (eventsArr.length === 0) {
      throw new Error('לא זוהו אירועים בקלט שהוזן.');
    }

    populateEventsBatch(eventsArr, 0);
    if (eventsArr.length > 1) {
      showToast(`זוהו ${eventsArr.length} אירועים! דפדף ביניהם או שמור ברצף`, 'check');
    } else {
      showToast('פרטי האירוע חולצו בהצלחה!', 'check');
    }
    // גלילה חלקה אל כרטיס התוצאה
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('שגיאה בעיבוד ה-AI:', error);
    showToast(`שגיאה בפענוח: ${error.message || 'אנא נסה שוב'}`, 'alert-circle');
  } finally {
    setLoadingState(false);
  }
}

// קריאה ישירה ל-Google Gemini API עם Structured Outputs (JSON Schema) ותמיכה בריבוי אירועים
async function callGeminiApi(contents, apiKey) {
  let model = getModel();
  if (!model || model.includes('2.5') || model.includes('1.5') || model.includes('2.0')) {
    model = 'gemini-3.8-flash';
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const now = new Date();
  const localIso = now.toISOString();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';

  const systemInstruction = `
אתה "SmartCal Linker" - מנוע AI מומחה לחילוץ פרטי אירועים ויומנים עבור Google Calendar.
זמן מקומי נוכחי: ${localIso}
אזור זמן: ${timeZone}

הנחיות חילוץ וניתוח:
1. כותרת (title): חלץ כותרת ברורה, מדויקת ותקנית בעברית, ללא שיבושי סדר מילים (לדוגמה: "AI בארגון - מניסוי נקודתי ליכולת שעובדת").
2. זמנים ושעות (startTime, endTime):
   - חלץ את שעת ההתחלה בפורמט HH:mm בדיוק (שעון 24, לדוגמה "10:30").
   - שעת סיום: אם לא צוינה מפורשות שעת סיום, קבע אותה כשעה אחת בדיוק לאחר שעת ההתחלה (לדוגמה: אם ההתחלה היא 10:30, שעת הסיום תהיה 11:30).
3. יום שלם (isAllDay): אם מדובר באירוע ללא שעות ספציפיות (חג, יום הולדת, יום חופש), סמן true והשאר את השעות ריקות.
4. מיקום (location): אם מדובר בוובינר מקוון, כנס רשת או מפגש דיגיטלי, רשום תמיד: "אונליין (Zoom)" או "מקוון" או קישור להצטרפות. אם האירוע פיזי, חלץ כתובת. אל תשאיר מיקום ריק אם ידוע שזה אירוע מקוון/אונליין!
5. פירוט והערות (description): חובה למלא תמיד! חלץ תקציר בהיר של נושאי האירוע, סדר יום, שמות המרצים, וקישור לדף האירוע או ההרשמה.
6. פתור ביטויי זמן יחסיים (מחר, מחרתיים, שבוע הבא) בהתייחס לזמן הנוכחי.
7. חזרתיות (recurrence): אם מוזכר שהאירוע קבוע או חוזר (למשל "כל יום שלישי", "מפגש שבועי", "מדי חודש", "יומי", "פעם בשבועיים"), ציין מחרוזת RRULE תקנית:
   - לאירוע שבועי ביום ספציפי חובה לציין BYDAY (לדוגמה: "RRULE:FREQ=WEEKLY;BYDAY=TU" ליום שלישי, כשקודי הימים הם SU,MO,TU,WE,TH,FR,SA).
   - לדו-שבועי: "RRULE:FREQ=WEEKLY;INTERVAL=2". ליומי: "RRULE:FREQ=DAILY". לחודשי: "RRULE:FREQ=MONTHLY". לשנתי: "RRULE:FREQ=YEARLY".
   - אם זה אירוע חד-פעמי, החזר מחרוזת ריקה ("").
8. אזורי זמן זרים: אם שעת האירוע מצוינת באזור זמן זר (למשל EST, PST, GMT, CET), תרגם את השעות לזמן ישראל (${timeZone}) וציין בהערות את שעת המקור ואזור הזמן המקורי.
9. ריבוי אירועים (Multi-Events) מול אירוע חוזר:
   - אם הקלט מתאר מפגש קבוע החוזר על עצמו באותה מתכונת (כגון "כל יום שלישי ב-20:00"), החזר אירוע אחד בלבד במערך events עם שדה recurrence מתאים.
   - אם הקלט מכיל מספר אירועים נפרדים או מועדים שונים (למשל: טיסת הלוך וטיסת חזור, לו"ז כנס או טיול עם מספר מפגשים/הרצאות, רשימת משמרות או תורים בימים שונים, או פלייר עם מספר תאריכי מופעים) — חלץ כל אירוע כאיבר נפרד במערך events ומיין אותם בסדר כרונולוגי!
   - שימור הקשר משותף: פרטים משותפים המופיעים בקלט (כגון כתובת הכנס, קישור זום משותף, מספר הזמנה/PNR או מוזמנים) יש לשלב בכל אחד מהאירועים הרלוונטיים במערך כדי שכל אירוע יעמוד בפני עצמו ביומן.
`.trim();

  const eventItemSchema = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "כותרת קצרה, מדויקת וברורה של האירוע בעברית" },
      isAllDay: { type: "BOOLEAN", description: "האם זה אירוע של יום שלם ללא שעה נקובה" },
      startDate: { type: "STRING", description: "תאריך התחלה בפורמט YYYY-MM-DD" },
      startTime: { type: "STRING", description: "שעת התחלה בפורמט HH:mm בדיוק (למשל 10:30), או ריק אם יום שלם" },
      endDate: { type: "STRING", description: "תאריך סיום בפורמט YYYY-MM-DD" },
      endTime: { type: "STRING", description: "שעת סיום בפורמט HH:mm בדיוק (למשל 11:30), או ריק אם יום שלם" },
      recurrence: { type: "STRING", description: "תבנית חזרתיות תקנית RRULE אם האירוע קבוע, או ריק אם חד-פעמי" },
      location: { type: "STRING", description: "מיקום פיזי, אונליין (Zoom), או קישור לשיחה" },
      description: { type: "STRING", description: "תקציר האירוע, נושאים, מרצים וקישור הרשמה" },
      attendees: { 
        type: "ARRAY", 
        items: { type: "STRING" },
        description: "רשימת אימיילים של משתתפים אם הוזכרו"
      }
    },
    required: ["title", "isAllDay", "startDate", "endDate", "startTime", "endTime", "location", "description"]
  };

  const responseSchema = {
    type: "OBJECT",
    properties: {
      events: {
        type: "ARRAY",
        description: "רשימת כל האירועים שזוהו מתוך הקלט, ממוינים בסדר כרונולוגי (אירוע אחד או יותר)",
        items: eventItemSchema
      }
    },
    required: ["events"]
  };

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        parts: contents
      }
    ],
    generationConfig: {
      temperature: 0.1, // חילוץ עובדתי דטרמיניסטי
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    throw new Error(errorJson?.error?.message || `שגיאת רשת (${response.status})`);
  }

  const jsonResult = await response.json();
  const textOutput = jsonResult.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    throw new Error('התקבלה תשובה ריקה מה-AI.');
  }

  return JSON.parse(textOutput);
}

// נירמול שעה לפורמט 24 שעות קשיח HH:mm (הנדרש ע"י input type="time")
function normalizeTime(val, defaultFallback = '') {
  if (!val) return defaultFallback;
  val = String(val).trim();
  const m = val.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = m[2];
    if (/pm|אחה"צ|בערב/i.test(val) && hours < 12) {
      hours += 12;
    } else if (/am|בבוקר/i.test(val) && hours === 12) {
      hours = 0;
    }
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  return defaultFallback;
}

// מילון תרגום ימי שבוע לעברית
const DAY_MAP = {
  SU: 'יום ראשון',
  MO: 'יום שני',
  TU: 'יום שלישי',
  WE: 'יום רביעי',
  TH: 'יום חמישי',
  FR: 'יום שישי',
  SA: 'יום שבת'
};

// פענוח ועיצוב מחרוזת RRULE לתיאור עברי ברור
function formatRecurrenceHebrew(rrule) {
  if (!rrule) return '';
  rrule = String(rrule).toUpperCase().trim();
  if (!rrule.startsWith('RRULE:')) rrule = 'RRULE:' + rrule;

  if (rrule.includes('INTERVAL=2') && rrule.includes('WEEKLY')) return 'דו-שבועי (כל שבועיים)';
  if (rrule.includes('FREQ=DAILY')) return 'יומי (כל יום)';
  if (rrule.includes('FREQ=MONTHLY')) return 'חודשי (פעם בחודש)';
  if (rrule.includes('FREQ=YEARLY')) return 'שנתי (פעם בשנה)';
  
  if (rrule.includes('FREQ=WEEKLY')) {
    const bydayMatch = rrule.match(/BYDAY=([A-Z,]+)/);
    if (bydayMatch) {
      const days = bydayMatch[1].split(',').map(d => DAY_MAP[d] || d).join(', ');
      return `שבועי (בכל ${days})`;
    }
    return 'שבועי (פעם בשבוע)';
  }

  return 'אירוע חוזר';
}

// קביעת ערך חזרתיות בטופס, סנכרון תפריט הבחירה והדגשת תגית וחיווי ויזואלי
function setRecurrenceValue(rrule) {
  const select = document.getElementById('eventRecurrence');
  const badge = document.getElementById('recurringBadge');
  const badgeText = document.getElementById('recurringBadgeText');
  const container = document.getElementById('recurrenceRowContainer');

  if (!select) return;

  rrule = (rrule || '').trim();
  if (rrule && !rrule.toUpperCase().startsWith('RRULE:')) {
    rrule = 'RRULE:' + rrule;
  }

  if (!rrule) {
    select.value = '';
    if (badge) badge.classList.add('hidden');
    if (container) {
      container.classList.remove('bg-purple-50/70', 'border-purple-200');
      container.classList.add('bg-gray-50/80', 'border-gray-100');
    }
    return;
  }

  // בדיקה האם האופציה כבר קיימת ב-select
  let option = Array.from(select.options).find(opt => opt.value === rrule);
  if (!option) {
    // הוספה דינמית של האפשרות כדי שה-select לא יוצג ריק
    const label = formatRecurrenceHebrew(rrule);
    option = document.createElement('option');
    option.value = rrule;
    option.textContent = label;
    select.appendChild(option);
  }

  select.value = rrule;

  // עדכון תגית עליונה בולטת והדגשת שורת החזרתיות
  const hebrewDesc = formatRecurrenceHebrew(rrule);
  if (badge && badgeText) {
    badgeText.textContent = hebrewDesc;
    badge.classList.remove('hidden');
  }
  if (container) {
    container.classList.remove('bg-gray-50/80', 'border-gray-100');
    container.classList.add('bg-purple-50/70', 'border-purple-200');
  }

  if (window.lucide) window.lucide.createIcons();
}

// עזרי תאריכים חסינים לשגיאות (למניעת RangeError בעת עריכה ידנית או מעבר חצות)
function getSafeDateStr(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) {
    return String(dateStr).trim();
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDateStr(dateStr, days) {
  const safe = getSafeDateStr(dateStr);
  const [y, m, d] = safe.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// --- 10. נירמול וניהול סדרת אירועים (Single & Multi-Events Batch) ---
function normalizeSingleEventData(raw) {
  const data = { ...(raw || {}) };
  const safeStartDate = getSafeDateStr(data.startDate);
  let safeEndDate = (data.endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(data.endDate).trim()))
    ? String(data.endDate).trim()
    : safeStartDate;

  let cleanStartTime = '';
  let cleanEndTime = '';

  if (!data.isAllDay) {
    cleanStartTime = normalizeTime(data.startTime, '10:00');
    cleanEndTime = normalizeTime(data.endTime);
    if (!cleanEndTime && cleanStartTime) {
      const [h, m] = cleanStartTime.split(':').map(Number);
      const endH = (h + 1) % 24;
      cleanEndTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      // אם שעת הסיום גלשה מעבר לחצות (למשל 23:30 -> 00:30), נקדם את תאריך הסיום ביום אחד
      if (endH < h && safeEndDate === safeStartDate) {
        safeEndDate = addDaysToDateStr(safeStartDate, 1);
      }
    }
  }

  return {
    title: data.title || 'אירוע חדש',
    isAllDay: !!data.isAllDay,
    startDate: safeStartDate,
    startTime: cleanStartTime,
    endDate: safeEndDate,
    endTime: cleanEndTime,
    recurrence: (data.recurrence || '').trim(),
    location: data.location || '',
    description: data.description || '',
    attendees: Array.isArray(data.attendees) ? data.attendees : [],
    _exported: !!data._exported
  };
}

// טעינת מערך אירועים (או אירוע בודד) לתוך המערכת
function populateEventsBatch(eventsInput, activeIdx = 0) {
  let rawArray = [];
  if (Array.isArray(eventsInput)) {
    rawArray = eventsInput;
  } else if (eventsInput && Array.isArray(eventsInput.events)) {
    rawArray = eventsInput.events;
  } else if (eventsInput && typeof eventsInput === 'object') {
    rawArray = [eventsInput];
  }

  if (rawArray.length === 0) return;

  parsedEventsList = rawArray.map(ev => normalizeSingleEventData(ev));
  currentEventIndex = Math.min(Math.max(0, activeIdx), parsedEventsList.length - 1);
  hasExported = parsedEventsList.every(ev => ev._exported);

  // שמירת כל האירועים שחולצו להיסטוריה (בסדר הפוך כדי שהראשון יופיע ראשון בהיסטוריה)
  for (let i = parsedEventsList.length - 1; i >= 0; i--) {
    saveToHistory(parsedEventsList[i]);
  }

  loadCurrentEventIntoForm(false);
  renderMultiEventBar();

  document.getElementById('resultCard')?.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

// מעטפת תאימות לאחור לטעינת אירוע בודד (למשל מתוך חלון ההיסטוריה)
function populateEventForm(data) {
  populateEventsBatch([data], 0);
}

// טעינת האירוע הפעיל הנוכחי (parsedEventsList[currentEventIndex]) לשדות הטופס
function loadCurrentEventIntoForm(animateSwitch = false) {
  if (!parsedEventsList.length) return;
  if (currentEventIndex < 0 || currentEventIndex >= parsedEventsList.length) {
    currentEventIndex = 0;
  }

  const data = parsedEventsList[currentEventIndex];
  currentParsedEvent = data;

  document.getElementById('eventTitle').value = data.title || '';
  const isAllDayCheckbox = document.getElementById('eventIsAllDay');
  isAllDayCheckbox.checked = !!data.isAllDay;

  document.getElementById('eventStartDate').value = data.startDate || '';
  document.getElementById('eventStartTime').value = data.startTime || '';

  document.getElementById('eventEndDate').value = data.endDate || data.startDate || '';
  document.getElementById('eventEndTime').value = data.endTime || '';

  setRecurrenceValue(data.recurrence || '');

  document.getElementById('eventLocation').value = data.location || '';
  const descEl = document.getElementById('eventDescription');
  descEl.value = data.description || '';
  autoResizeTextarea(descEl);

  if (Array.isArray(data.attendees) && data.attendees.length > 0) {
    document.getElementById('eventAttendees').value = data.attendees.join(', ');
  } else {
    document.getElementById('eventAttendees').value = '';
  }

  toggleAllDayUI(data.isAllDay);
  refreshCalendarLinks();

  if (animateSwitch) {
    const formEl = document.getElementById('eventForm');
    if (formEl) {
      formEl.classList.remove('event-switch-highlight');
      void formEl.offsetWidth; // trigger reflow
      formEl.classList.add('event-switch-highlight');
    }
  }
}

// מעבר יזום לאירוע לפי אינדקס
function selectEventByIndex(idx, animate = true) {
  if (idx < 0 || idx >= parsedEventsList.length) return;
  currentEventIndex = idx;
  loadCurrentEventIntoForm(animate);
  renderMultiEventBar();
  if (window.lucide) window.lucide.createIcons();
}

// הסרת אירוע בודד מתוך סדרת אירועים
function removeEventFromBatch(idx) {
  if (parsedEventsList.length <= 1) {
    requestNewEvent();
    return;
  }
  const removed = parsedEventsList.splice(idx, 1)[0];
  if (currentEventIndex >= parsedEventsList.length) {
    currentEventIndex = parsedEventsList.length - 1;
  }
  hasExported = parsedEventsList.every(ev => ev._exported);
  loadCurrentEventIntoForm(true);
  renderMultiEventBar();
  showToast(`האירוע "${removed.title || ''}" הוסר מהרשימה`, 'check');
}

// עיצוב תאריך קצר לכרטיסיית האירוע (DD/MM)
function formatShortDateHebrew(dateStr, timeStr, isAllDay) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const shortDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;
  return isAllDay ? `${shortDate} (יום שלם)` : `${shortDate} • ${timeStr || ''}`;
}

// רינדור סרגל ריבוי האירועים וכפתורי ה-Batch (מוסתר באירוע בודד, מוצג ב-2+ אירועים)
function renderMultiEventBar() {
  const bar = document.getElementById('multiEventBar');
  const batchActions = document.getElementById('multiEventBatchActions');
  const pillsContainer = document.getElementById('multiEventPillsContainer');
  const countBadge = document.getElementById('multiEventCountBadge');
  const savedBadge = document.getElementById('multiEventSavedBadge');
  const prevBtn = document.getElementById('prevEventBtn');
  const nextBtn = document.getElementById('nextEventBtn');
  const cardTitle = document.getElementById('resultCardTitle');
  const cardSubtitle = document.getElementById('resultCardSubtitle');
  const googleBtnText = document.getElementById('addToGoogleBtnText');
  const downloadAllIcsText = document.getElementById('downloadAllIcsBtnText');
  const nextUnsavedBtn = document.getElementById('openNextUnsavedGoogleBtn');

  const total = parsedEventsList.length;

  if (total <= 1) {
    bar?.classList.add('hidden');
    batchActions?.classList.add('hidden');
    if (cardTitle) cardTitle.textContent = 'פרטי האירוע שזוהו';
    if (cardSubtitle) cardSubtitle.textContent = 'בדוק, ערוך במידת הצורך ולחץ להוספה';
    if (googleBtnText) googleBtnText.textContent = 'פתח ושמור ביומן Google';
    return;
  }

  bar?.classList.remove('hidden');
  batchActions?.classList.remove('hidden');

  const savedCount = parsedEventsList.filter(e => e._exported).length;
  const activeEv = parsedEventsList[currentEventIndex] || {};

  if (cardTitle) {
    cardTitle.textContent = `אירוע ${currentEventIndex + 1} מתוך ${total} שזוהו`;
  }
  if (cardSubtitle) {
    cardSubtitle.textContent = activeEv._exported
      ? 'אירוע זה כבר נשמר ביומן ✓ ניתן לערוך או לעבור לאירוע הבא'
      : 'בדוק את פרטי האירוע הנוכחי ולחץ להוספה (יעבור אוטומטית לבא)';
  }
  if (countBadge) countBadge.textContent = `זוהו ${total} אירועים`;
  if (savedBadge) {
    savedBadge.textContent = `נשמרו ${savedCount}/${total}`;
    savedBadge.className = savedCount === total
      ? 'text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-lg'
      : 'text-[11px] font-semibold text-indigo-700 bg-indigo-100/80 border border-indigo-200 px-2 py-0.5 rounded-lg';
  }

  if (prevBtn) prevBtn.disabled = currentEventIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentEventIndex >= total - 1;

  if (googleBtnText) {
    googleBtnText.textContent = activeEv._exported
      ? `פתח שוב ביומן Google (אירוע ${currentEventIndex + 1}/${total} ✓)`
      : `פתח ושמור ביומן Google (אירוע ${currentEventIndex + 1}/${total})`;
  }
  if (downloadAllIcsText) {
    downloadAllIcsText.textContent = `הורד קובץ ICS מאוחד (${total} אירועים)`;
  }
  if (nextUnsavedBtn) {
    const hasUnsavedOther = parsedEventsList.some((e, i) => i !== currentEventIndex && !e._exported);
    nextUnsavedBtn.disabled = !hasUnsavedOther;
    nextUnsavedBtn.classList.toggle('opacity-50', !hasUnsavedOther);
    nextUnsavedBtn.classList.toggle('cursor-not-allowed', !hasUnsavedOther);
  }

  if (!pillsContainer) return;
  pillsContainer.innerHTML = '';

  parsedEventsList.forEach((ev, idx) => {
    const isCurrent = idx === currentEventIndex;
    const isSaved = !!ev._exported;

    const pill = document.createElement('div');
    pill.className = isCurrent
      ? 'flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-indigo-600 bg-white text-indigo-950 shadow-xs shrink-0 cursor-pointer transition-all max-w-[230px]'
      : (isSaved
        ? 'flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-white shrink-0 cursor-pointer transition-all max-w-[210px]'
        : 'flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white/80 hover:bg-white text-gray-700 shrink-0 cursor-pointer transition-all max-w-[210px]');

    const badgeHtml = isSaved
      ? `<span class="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0" title="נשמר ביומן">✓</span>`
      : `<span class="w-5 h-5 rounded-full ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'} flex items-center justify-center text-[11px] font-bold shrink-0">${idx + 1}</span>`;

    const dateSub = formatShortDateHebrew(ev.startDate, ev.startTime, ev.isAllDay);

    pill.innerHTML = `
      ${badgeHtml}
      <div class="truncate text-right flex-1 min-w-0">
        <div class="text-xs font-bold truncate">${ev.title || 'אירוע'}</div>
        <div class="text-[10px] ${isCurrent ? 'text-indigo-600 font-semibold' : 'text-gray-500'} truncate">${dateSub}</div>
      </div>
      <button type="button" class="remove-batch-ev-btn p-0.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0" title="הסר אירוע זה מהרשימה">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    `;

    pill.addEventListener('click', (e) => {
      if (e.target.closest('.remove-batch-ev-btn')) return;
      selectEventByIndex(idx, true);
    });

    pill.querySelector('.remove-batch-ev-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEventFromBatch(idx);
    });

    pillsContainer.appendChild(pill);

    if (isCurrent) {
      setTimeout(() => {
        pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }, 50);
    }
  });

  if (window.lucide) window.lucide.createIcons();
}

// סימון האירוע הנוכחי כנשמר ומעבר אוטומטי לאירוע הבא שטרם נשמר (אם יש)
function markCurrentEventExported(autoAdvance = false) {
  if (!currentParsedEvent) return;
  currentParsedEvent._exported = true;
  if (parsedEventsList[currentEventIndex]) {
    parsedEventsList[currentEventIndex]._exported = true;
  }
  hasExported = parsedEventsList.length > 0 && parsedEventsList.every(ev => ev._exported);
  saveToHistory(currentParsedEvent);
  renderMultiEventBar();

  if (autoAdvance && parsedEventsList.length > 1) {
    const prevIdx = currentEventIndex;
    const nextUnsavedIdx = findNextUnsavedIndex(currentEventIndex);
    if (nextUnsavedIdx !== -1 && nextUnsavedIdx !== currentEventIndex) {
      setTimeout(() => {
        selectEventByIndex(nextUnsavedIdx, true);
        showToast(`אירוע ${prevIdx + 1} נשמר! עברנו אוטומטית לאירוע ${nextUnsavedIdx + 1} מתוך ${parsedEventsList.length}`, 'check');
      }, 450);
    } else if (hasExported) {
      setTimeout(() => {
        showToast(`כל ${parsedEventsList.length} האירועים בסדרה נשמרו בהצלחה!`, 'check');
      }, 350);
    }
  }
}

function findNextUnsavedIndex(fromIdx) {
  const total = parsedEventsList.length;
  if (total <= 1) return -1;
  for (let offset = 1; offset < total; offset++) {
    const candidate = (fromIdx + offset) % total;
    if (!parsedEventsList[candidate]._exported) {
      return candidate;
    }
  }
  return -1;
}

// התאמת גובה תיבת טקסט אוטומטית לפי כמות התוכן (ללא גלילה חנוקה)
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.max(el.scrollHeight, 75);
  el.style.height = `${newHeight + 4}px`;
}

// עדכון ממשק עבור אירוע יום שלם
function toggleAllDayUI(isAllDay) {
  const startTimeInput = document.getElementById('eventStartTime');
  const endTimeInput = document.getElementById('eventEndTime');
  const badge = document.getElementById('allDayBadge');

  if (isAllDay) {
    startTimeInput.disabled = true;
    endTimeInput.disabled = true;
    startTimeInput.classList.add('opacity-40', 'bg-gray-100');
    endTimeInput.classList.add('opacity-40', 'bg-gray-100');
    badge.classList.remove('hidden');
  } else {
    startTimeInput.disabled = false;
    endTimeInput.disabled = false;
    startTimeInput.classList.remove('opacity-40', 'bg-gray-100');
    endTimeInput.classList.remove('opacity-40', 'bg-gray-100');
    badge.classList.add('hidden');
  }
}

// האזנה לשינויים ידניים בטופס לעדכון מיידי של הלינקים
function setupFormChangeListeners() {
  const form = document.getElementById('eventForm');
  const isAllDayCheckbox = document.getElementById('eventIsAllDay');
  const descEl = document.getElementById('eventDescription');
  const textInput = document.getElementById('textInput');

  // כוונון גובה אוטומטי בהקלדה
  if (descEl) {
    descEl.addEventListener('input', () => autoResizeTextarea(descEl));
  }
  if (textInput) {
    textInput.addEventListener('input', () => autoResizeTextarea(textInput));
  }

  // כפתור הרחבה/כיווץ ידני לפירוט והערות
  const toggleExpandBtn = document.getElementById('toggleDescExpandBtn');
  const expandLabel = document.getElementById('expandBtnLabel');
  let isExpanded = false;
  if (toggleExpandBtn && descEl) {
    toggleExpandBtn.addEventListener('click', () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        descEl.style.height = `${Math.max(descEl.scrollHeight + 40, 220)}px`;
        if (expandLabel) expandLabel.textContent = 'כווץ תיבה';
      } else {
        autoResizeTextarea(descEl);
        if (expandLabel) expandLabel.textContent = 'הרחב תיבה';
      }
    });
  }

  // כפתורי ניווט בסרגל ריבוי אירועים (הקודם / הבא / דלג לבא שטרם נשמר / הורד ICS מאוחד)
  document.getElementById('prevEventBtn')?.addEventListener('click', () => {
    if (currentEventIndex > 0) selectEventByIndex(currentEventIndex - 1, true);
  });
  document.getElementById('nextEventBtn')?.addEventListener('click', () => {
    if (currentEventIndex < parsedEventsList.length - 1) selectEventByIndex(currentEventIndex + 1, true);
  });
  document.getElementById('downloadAllIcsBtn')?.addEventListener('click', handleDownloadAllIcs);
  document.getElementById('openNextUnsavedGoogleBtn')?.addEventListener('click', () => {
    const nextIdx = findNextUnsavedIndex(currentEventIndex);
    if (nextIdx !== -1) {
      selectEventByIndex(nextIdx, true);
      showToast(`עברנו לאירוע ${nextIdx + 1} מתוך ${parsedEventsList.length}`, 'info');
    } else {
      showToast('כל האירועים בסדרה כבר נשמרו!', 'check');
    }
  });

  // כפתורי איפוס לאירוע חדש (זיהוי חכם והגנה מותנית)
  const resetFromCardBtn = document.getElementById('resetFromCardBtn');
  const resetAllBtn = document.getElementById('resetAllBtn');
  if (resetFromCardBtn) resetFromCardBtn.addEventListener('click', requestNewEvent);
  if (resetAllBtn) resetAllBtn.addEventListener('click', requestNewEvent);

  // חיבור כפתורי מודל האישור המותנה
  setupConfirmResetModal();

  if (isAllDayCheckbox) {
    isAllDayCheckbox.addEventListener('change', (e) => {
      toggleAllDayUI(e.target.checked);
      readFormDataAndUpdateLinks();
    });
  }

  const inputs = form.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.addEventListener('input', readFormDataAndUpdateLinks);
    input.addEventListener('change', readFormDataAndUpdateLinks);
  });

  const recSelect = document.getElementById('eventRecurrence');
  if (recSelect) {
    recSelect.addEventListener('change', (e) => {
      setRecurrenceValue(e.target.value);
    });
  }

  // כפתור הורדת קובץ ICS (לאירוע הנוכחי)
  document.getElementById('downloadIcsBtn').addEventListener('click', handleDownloadIcs);

  // כפתור העתקת קישור
  document.getElementById('copyLinkBtn').addEventListener('click', handleCopyDirectLink);
}

// בדיקה חכמה לפני איפוס: האם כל האירועים כבר נשמרו/יוצאו?
function requestNewEvent() {
  const allSaved = parsedEventsList.length === 0 || parsedEventsList.every(e => e._exported);
  if (!currentParsedEvent || hasExported || allSaved) {
    // הכל כבר נשמר או שאין תוכן פעיל - מנקים מיד ללא חלון מעכב!
    executeResetForNewEvent();
  } else {
    // התאמת טקסט חלון האזהרה לאירוע בודד מול סדרת אירועים
    const titleEl = document.getElementById('confirmResetTitle');
    const descEl = document.getElementById('confirmResetDesc');
    const saveBtnTextEl = document.getElementById('saveAndResetBtnText');

    const total = parsedEventsList.length;
    const savedCount = parsedEventsList.filter(e => e._exported).length;
    const unsavedCount = total - savedCount;

    if (total > 1) {
      if (titleEl) titleEl.textContent = `נותרו ${unsavedCount} אירועים שטרם נשמרו ביומן!`;
      if (descEl) {
        descEl.textContent = `מתוך ${total} אירועים שזוהו, שמרת עד כה ${savedCount}. האם להוריד קובץ יומן מאוחד (.ICS) עם כל האירועים לפני הניקוי?`;
      }
      if (saveBtnTextEl) saveBtnTextEl.textContent = `הורד קובץ ICS מאוחד (${total} אירועים) ונקה`;
    } else {
      if (titleEl) titleEl.textContent = 'עדיין לא שמרת את האירוע ביומן!';
      if (descEl) {
        descEl.textContent = 'חילצת את פרטי האירוע, אך עדיין לא פתחת אותו ביומן Google ולא העתקת את הקישור. האם לנקות בכל זאת?';
      }
      if (saveBtnTextEl) saveBtnTextEl.textContent = 'פתח ביומן Google ונקה';
    }

    const modal = document.getElementById('confirmResetModal');
    if (modal) {
      modal.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// ניהול כפתורי מודל האזהרה המותנה
function setupConfirmResetModal() {
  const modal = document.getElementById('confirmResetModal');
  const saveAndResetBtn = document.getElementById('saveAndResetBtn');
  const discardAndResetBtn = document.getElementById('discardAndResetBtn');
  const cancelResetBtn = document.getElementById('cancelResetBtn');

  if (saveAndResetBtn) {
    saveAndResetBtn.addEventListener('click', () => {
      if (parsedEventsList.length > 1) {
        handleDownloadAllIcs();
      } else {
        const addBtn = document.getElementById('addToGoogleBtn');
        if (addBtn && addBtn.href) {
          window.open(addBtn.href, '_blank');
        }
        if (currentParsedEvent) {
          saveToHistory(currentParsedEvent);
        }
      }
      modal?.classList.add('hidden');
      hasExported = true;
      executeResetForNewEvent();
    });
  }

  if (discardAndResetBtn) {
    discardAndResetBtn.addEventListener('click', () => {
      modal?.classList.add('hidden');
      executeResetForNewEvent();
    });
  }

  if (cancelResetBtn) {
    cancelResetBtn.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });
  }

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

// ביצוע איפוס מלא של הדף + יצירת נקודת שחזור (Undo) כולל סדרות מרובות אירועים
function executeResetForNewEvent() {
  // שמירת מצב קודם למקרה שהמשתמש ירצה לבטל מחיקה
  if (currentParsedEvent || parsedEventsList.length > 0) {
    lastClearedState = {
      parsedEvent: currentParsedEvent ? JSON.parse(JSON.stringify(currentParsedEvent)) : null,
      parsedEventsList: JSON.parse(JSON.stringify(parsedEventsList)),
      currentEventIndex: currentEventIndex,
      textVal: document.getElementById('textInput')?.value || ''
    };
  }

  // 1. איפוס שדות טקסט
  const textInput = document.getElementById('textInput');
  if (textInput) {
    textInput.value = '';
    textInput.style.height = 'auto';
  }

  // 2. איפוס תמונה
  imageBase64Data = null;
  const imageInput = document.getElementById('imageFileInput');
  if (imageInput) imageInput.value = '';
  document.getElementById('imagePreviewContainer')?.classList.add('hidden');
  document.getElementById('imagePlaceholder')?.classList.remove('hidden');

  // 3. איפוס PDF
  pdfBase64Data = null;
  const pdfInput = document.getElementById('pdfFileInput');
  if (pdfInput) pdfInput.value = '';
  document.getElementById('pdfInfoContainer')?.classList.add('hidden');
  document.getElementById('pdfPlaceholder')?.classList.remove('hidden');

  // 4. איפוס הקלטה קולית
  audioBase64Data = null;
  const audioPreview = document.getElementById('audioPreview');
  if (audioPreview) audioPreview.src = '';
  document.getElementById('audioPlaybackContainer')?.classList.add('hidden');
  document.getElementById('recordingTimer')?.classList.add('hidden');
  const voiceStatus = document.getElementById('voiceStatusText');
  if (voiceStatus) voiceStatus.textContent = 'לחץ על המיקרופון והקלט את האירוע';

  // 5. איפוס כרטיס תוצאה וסדרת אירועים
  currentParsedEvent = null;
  parsedEventsList = [];
  currentEventIndex = 0;
  hasExported = false;
  document.getElementById('eventForm')?.reset();
  setRecurrenceValue('');
  const descEl = document.getElementById('eventDescription');
  if (descEl) descEl.style.height = 'auto';
  document.getElementById('multiEventBar')?.classList.add('hidden');
  document.getElementById('multiEventBatchActions')?.classList.add('hidden');
  document.getElementById('resultCard')?.classList.add('hidden');

  // 6. חזרה לטאב טקסט
  const tabText = document.getElementById('tabText');
  if (tabText) tabText.click();

  // 7. גלילה חלקה למעלה והתמקדות
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    textInput?.focus();
  }, 250);

  // 8. הצגת הודעה מלווה בכפתור שחזור (Undo)
  showToastWithUndo('הדף נוקה לקראת אירוע חדש', restoreLastClearedState);
}

// שחזור הנתונים שנמחקו (Undo) - תומך בשחזור סדרת אירועים מלאה
function restoreLastClearedState() {
  if (!lastClearedState) return;

  if (lastClearedState.textVal) {
    const textInput = document.getElementById('textInput');
    if (textInput) {
      textInput.value = lastClearedState.textVal;
      autoResizeTextarea(textInput);
    }
  }

  if (Array.isArray(lastClearedState.parsedEventsList) && lastClearedState.parsedEventsList.length > 0) {
    populateEventsBatch(lastClearedState.parsedEventsList, lastClearedState.currentEventIndex || 0);
    document.getElementById('resultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const count = lastClearedState.parsedEventsList.length;
    showToast(count > 1 ? `שוחזרו ${count} האירועים בהצלחה!` : 'האירוע שוחזר בהצלחה!', 'check');
  } else if (lastClearedState.parsedEvent) {
    populateEventsBatch([lastClearedState.parsedEvent], 0);
    document.getElementById('resultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('האירוע שוחזר בהצלחה!', 'check');
  }

  lastClearedState = null;
}

function readFormDataAndUpdateLinks() {
  const isAllDay = document.getElementById('eventIsAllDay').checked;
  const attendeesRaw = document.getElementById('eventAttendees').value;
  const attendees = attendeesRaw ? attendeesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const updatedEvent = {
    title: document.getElementById('eventTitle').value,
    isAllDay: isAllDay,
    startDate: document.getElementById('eventStartDate').value,
    startTime: document.getElementById('eventStartTime').value,
    endDate: document.getElementById('eventEndDate').value,
    endTime: document.getElementById('eventEndTime').value,
    recurrence: document.getElementById('eventRecurrence')?.value || '',
    location: document.getElementById('eventLocation').value,
    description: document.getElementById('eventDescription').value,
    attendees: attendees,
    _exported: false // עריכה ידנית מסמנת שהשינוי טרם נשמר
  };

  currentParsedEvent = updatedEvent;
  if (parsedEventsList.length > 0 && currentEventIndex < parsedEventsList.length) {
    parsedEventsList[currentEventIndex] = updatedEvent;
  }
  hasExported = parsedEventsList.length > 0 && parsedEventsList.every(e => e._exported);

  refreshCalendarLinks();
  if (parsedEventsList.length > 1) {
    renderMultiEventBar();
  }
}

// ניקוי טקסט עבור פרמטר URL: הסרת Markdown וחיתוך חכם בגבול מילה
function cleanTextForUrl(text, maxChars = 350) {
  if (!text) return '';
  let clean = text
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2') // קישורי markdown
    .replace(/[*_#`~>]/g, '') // הסרת תווי markdown
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (clean.length <= maxChars) return clean;

  let trimmed = clean.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.75) {
    trimmed = trimmed.slice(0, lastSpace);
  }
  return trimmed + '...';
}

// --- 11. בניית קישור Google Calendar חסין לשגיאות (פרוטוקול 2יומן) ---
function refreshCalendarLinks() {
  if (!currentParsedEvent) return;

  const ev = currentParsedEvent;
  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.id === currentAccountKey) || accounts[0] || { name: 'אישי', email: '' };

  // 1. טיפול בתאריכים לפי יום שלם מול שעה מוגדרת (חסין מפני תאריך ריק בעת עריכה)
  const safeStart = getSafeDateStr(ev.startDate);
  const safeEnd = (ev.endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.endDate).trim()))
    ? String(ev.endDate).trim()
    : safeStart;

  let datesParam = '';

  if (ev.isAllDay) {
    // ביום שלם בגוגל: YYYYMMDD/YYYYMMDD (תאריך הסיום הוא בלעדי, קרי יום אחד אחרי תאריך הסיום האמיתי)
    const startClean = safeStart.replace(/-/g, '');
    const endPlusOne = addDaysToDateStr(safeEnd, 1).replace(/-/g, '');
    datesParam = `${startClean}/${endPlusOne}`;
  } else {
    // עם שעה: המרה מדויקת ל-UTC (YYYYMMDDTHHmmssZ)
    const sTime = normalizeTime(ev.startTime, '10:00');
    const eTime = normalizeTime(ev.endTime, '11:00');
    const startIso = `${safeStart}T${sTime}:00`;
    const endIso = `${safeEnd}T${eTime}:00`;

    const startDateObj = new Date(startIso);
    const endDateObj = new Date(endIso);

    datesParam = `${formatDateToUtcString(startDateObj)}/${formatDateToUtcString(endDateObj)}`;
  }

  // 2. בניית פרמטרי ה-URL
  const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const params = new URLSearchParams();

  // כותרת
  params.set('text', ev.title || 'אירוע חדש');
  // תאריכים
  params.set('dates', datesParam);

  // חזרתיות (RRULE)
  if (ev.recurrence) {
    params.set('recur', ev.recurrence);
  }

  // פירוט והערות נקיים ומותאמים לתקציב URL
  if (ev.description) {
    params.set('details', cleanTextForUrl(ev.description, 350));
  }

  // מיקום
  if (ev.location) {
    params.set('location', ev.location);
    // עדכון לינק מפות
    const mapsLink = document.getElementById('mapsLink');
    if (mapsLink) {
      mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`;
      mapsLink.classList.remove('hidden');
    }
  } else {
    document.getElementById('mapsLink')?.classList.add('hidden');
  }

  // ניתוב חשבון יעד (2יומן)
  if (account.email) {
    params.set('authuser', account.email);
  }

  // צירוף מוזמנים (כולל קבוצת משפחה אם נבחרה)
  let allAttendees = [...(ev.attendees || [])];
  if (account.isGroup && account.groupEmails) {
    const groupList = account.groupEmails.split(',');
    groupList.forEach(email => {
      const trimmed = email.trim();
      if (trimmed && !allAttendees.includes(trimmed)) {
        allAttendees.push(trimmed);
      }
    });
  }

  if (allAttendees.length > 0) {
    params.set('add', allAttendees.join(','));
  }

  const finalGoogleUrl = `${baseUrl}&${params.toString()}`;

  // עדכון כפתור ה-Google Calendar (כולל קידום אוטומטי לאירוע הבא בריבוי אירועים!)
  const addBtn = document.getElementById('addToGoogleBtn');
  if (addBtn) {
    addBtn.href = finalGoogleUrl;
    if (!addBtn._exportClickBound) {
      addBtn._exportClickBound = true;
      addBtn.addEventListener('click', () => {
        markCurrentEventExported(true);
      });
    }
  }
}

// המרת Date לאובייקט UTC בפורמט גוגל: YYYYMMDDTHHmmssZ
function formatDateToUtcString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

// ניקוי והברחת תווים (Escaping) לפי תקן RFC 5545 עבור קובצי ICS
function escapeIcsText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// בניית בלוק VEVENT תקני עבור אירוע בודד (משמש גם לקובץ בודד וגם לקובץ מאוחד)
function buildIcsVEventLines(ev, account, uidSuffix = 0) {
  const safeStart = getSafeDateStr(ev.startDate);
  const safeEnd = (ev.endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.endDate).trim()))
    ? String(ev.endDate).trim()
    : safeStart;

  let dtStart, dtEnd;
  if (ev.isAllDay) {
    dtStart = `VALUE=DATE:${safeStart.replace(/-/g, '')}`;
    const endPlusOne = addDaysToDateStr(safeEnd, 1).replace(/-/g, '');
    dtEnd = `VALUE=DATE:${endPlusOne}`;
  } else {
    const sTime = normalizeTime(ev.startTime, '10:00');
    const eTime = normalizeTime(ev.endTime, '11:00');
    const s = new Date(`${safeStart}T${sTime}:00`);
    const e = new Date(`${safeEnd}T${eTime}:00`);
    dtStart = formatDateToUtcString(s);
    dtEnd = formatDateToUtcString(e);
  }

  let allAttendees = [...(ev.attendees || [])];
  if (account && account.isGroup && account.groupEmails) {
    account.groupEmails.split(',').forEach(em => {
      const trimmed = em.trim();
      if (trimmed && !allAttendees.includes(trimmed)) allAttendees.push(trimmed);
    });
  }
  const attendeeLines = allAttendees.map(email => `ATTENDEE;CN=${email};RSVP=TRUE:mailto:${email}`);

  return [
    'BEGIN:VEVENT',
    `UID:${Date.now()}_${uidSuffix}@smartcal.linker`,
    `DTSTAMP:${formatDateToUtcString(new Date())}`,
    `SUMMARY:${escapeIcsText(ev.title || 'אירוע')}`,
    ev.isAllDay ? `DTSTART;${dtStart}` : `DTSTART:${dtStart}`,
    ev.isAllDay ? `DTEND;${dtEnd}` : `DTEND:${dtEnd}`,
    ev.recurrence ? ev.recurrence : '',
    ev.location ? `LOCATION:${escapeIcsText(ev.location)}` : '',
    ev.description ? `DESCRIPTION:${escapeIcsText(ev.description)}` : '',
    ...attendeeLines,
    'STATUS:CONFIRMED',
    'END:VEVENT'
  ].filter(Boolean);
}

// --- 12. הורדת קובץ יומן (.ICS) לאירוע בודד או לכל הסדרה ---
function handleDownloadIcs() {
  if (!currentParsedEvent) return;
  const ev = currentParsedEvent;
  markCurrentEventExported(false);

  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.id === currentAccountKey) || accounts[0];
  const veventLines = buildIcsVEventLines(ev, account, currentEventIndex);

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartCal Linker//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...veventLines,
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsLines], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(ev.title || 'event').replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '_')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('קובץ היומן (.ics) הורד בהצלחה', 'check');
}

// הורדת קובץ ICS מאוחד עבור כל האירועים בסדרה בלחיצה אחת
function handleDownloadAllIcs() {
  if (!parsedEventsList.length) return;

  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.id === currentAccountKey) || accounts[0];

  const allVEvents = [];
  parsedEventsList.forEach((ev, idx) => {
    ev._exported = true;
    saveToHistory(ev);
    allVEvents.push(...buildIcsVEventLines(ev, account, idx + 1));
  });

  hasExported = true;
  renderMultiEventBar();

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartCal Linker//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...allVEvents,
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsLines], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const firstTitle = (parsedEventsList[0]?.title || 'events').replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '_');
  a.download = `${firstTitle}_${parsedEventsList.length}_אירועים.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`קובץ ICS מאוחד עם כל ${parsedEventsList.length} האירועים הורד בהצלחה!`, 'check');
}

// העתקת קישור ישיר
function handleCopyDirectLink() {
  const addBtn = document.getElementById('addToGoogleBtn');
  if (addBtn && addBtn.href) {
    markCurrentEventExported(false);
    navigator.clipboard.writeText(addBtn.href).then(() => {
      showToast('הקישור הועתק ללוח!', 'copy');
    }).catch(() => {
      showToast('שגיאה בהעתקת הקישור', 'alert-circle');
    });
  }
}

// פתיחה ביומן Outlook Web
function setupOutlookAction() {
  const outlookBtn = document.getElementById('addToOutlookBtn');
  if (outlookBtn) {
    outlookBtn.addEventListener('click', handleOpenOutlook);
  }
}

function handleOpenOutlook() {
  if (!currentParsedEvent) return;
  const ev = currentParsedEvent;
  markCurrentEventExported(true);

  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.id === currentAccountKey) || accounts[0];

  const safeStart = getSafeDateStr(ev.startDate);
  const safeEnd = (ev.endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.endDate).trim()))
    ? String(ev.endDate).trim()
    : safeStart;

  let startIso = '';
  let endIso = '';

  if (ev.isAllDay) {
    startIso = `${safeStart}T00:00:00`;
    endIso = `${safeEnd}T23:59:59`;
  } else {
    const sTime = normalizeTime(ev.startTime, '10:00');
    const eTime = normalizeTime(ev.endTime, '11:00');
    startIso = `${safeStart}T${sTime}:00`;
    endIso = `${safeEnd}T${eTime}:00`;
  }

  let allAttendees = [...(ev.attendees || [])];
  if (account && account.isGroup && account.groupEmails) {
    account.groupEmails.split(',').forEach(em => {
      const trimmed = em.trim();
      if (trimmed && !allAttendees.includes(trimmed)) allAttendees.push(trimmed);
    });
  }

  const baseOutlook = 'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent';
  const params = new URLSearchParams();
  params.set('subject', ev.title || 'אירוע חדש');
  params.set('startdt', startIso);
  params.set('enddt', endIso);
  if (ev.isAllDay) params.set('allday', 'true');
  if (ev.location) params.set('location', ev.location);
  if (ev.description) params.set('body', cleanTextForUrl(ev.description, 400));
  if (allAttendees.length > 0) params.set('to', allAttendees.join(';'));

  const outlookUrl = `${baseOutlook}&${params.toString()}`;
  window.open(outlookUrl, '_blank');
  showToast('האירוע נפתח ביומן Outlook Web', 'check');
}

// --- 13. הגדרות, ניהול מפתח API, אבטחת שיתוף וניהול יומני יעד ---
function isValidGeminiApiKey(key) {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.startsWith('AIza') && trimmed.length >= 30 && !/\s/.test(trimmed);
}

async function clearBackupConfigFromCacheStorage() {
  try {
    if ('caches' in window) {
      const cache = await caches.open('smartcal-config-backup-v1');
      await cache.delete('/__smartcal_saved_config__');
    }
  } catch (e) {}
}

function setupSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('openSettingsBtn');
  const closeBtn = document.getElementById('closeSettingsBtn');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  const toggleShowKeyBtn = document.getElementById('toggleShowApiKeyBtn');
  const disconnectKeyBtn = document.getElementById('disconnectApiKeyBtn');
  const openOnboardingFromSettingsBtn = document.getElementById('openOnboardingFromSettingsBtn');

  openBtn.addEventListener('click', () => {
    apiKeyInput.type = 'password';
    apiKeyInput.value = getApiKey();
    modelSelect.value = getModel();
    renderAccountsManagerList();
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // הצגה/הסתרה של מפתח ה-API (עין)
  if (toggleShowKeyBtn && apiKeyInput) {
    toggleShowKeyBtn.addEventListener('click', () => {
      const isPass = apiKeyInput.type === 'password';
      apiKeyInput.type = isPass ? 'text' : 'password';
    });
  }

  // ניתוק ומחיקה מלאה של מפתח ה-API מהמכשיר הנוכחי (לשמירה על שליטה וביטחון)
  if (disconnectKeyBtn && apiKeyInput) {
    disconnectKeyBtn.addEventListener('click', async () => {
      apiKeyInput.value = '';
      localStorage.removeItem('smartcal_api_key');
      await clearBackupConfigFromCacheStorage();
      showToast('מפתח ה-API נמחק ונותק ממכשיר זה בהצלחה', 'check');
    });
  }

  // פתיחת מדריך שלב-אחר-שלב מתוך ההגדרות
  if (openOnboardingFromSettingsBtn) {
    openOnboardingFromSettingsBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      openOnboardingModal();
    });
  }

  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;
    if (key && !isValidGeminiApiKey(key)) {
      showToast('מפתח ה-API נראה לא תקין (מפתח Gemini מתחיל ב-AIzaSy)', 'alert-circle');
      apiKeyInput.focus();
      return;
    }
    if (key) {
      localStorage.setItem('smartcal_api_key', key);
      backupConfigToCacheStorage({
        k: key,
        m: model,
        a: getStoredAccounts(),
        c: currentAccountKey
      });
    } else {
      localStorage.removeItem('smartcal_api_key');
      await clearBackupConfigFromCacheStorage();
    }
    localStorage.setItem('smartcal_model', model);
    modal.classList.add('hidden');
    showToast('ההגדרות נשמרו בהצלחה במכשיר', 'check');
  });

  // הצגה/הסתרה של אימיילים לקבוצה
  const isGroupCheckbox = document.getElementById('newAccountIsGroup');
  const groupEmailsCont = document.getElementById('groupEmailsContainer');
  if (isGroupCheckbox && groupEmailsCont) {
    isGroupCheckbox.addEventListener('change', () => {
      if (isGroupCheckbox.checked) {
        groupEmailsCont.classList.remove('hidden');
      } else {
        groupEmailsCont.classList.add('hidden');
      }
    });
  }

  // הוספת חשבון חדש
  const addAccountBtn = document.getElementById('addNewAccountBtn');
  const newNameInput = document.getElementById('newAccountName');
  const newEmailInput = document.getElementById('newAccountEmail');
  const newGroupEmailsInput = document.getElementById('newAccountGroupEmails');

  if (addAccountBtn && newNameInput && newEmailInput) {
    addAccountBtn.addEventListener('click', () => {
      const name = newNameInput.value.trim();
      const email = newEmailInput.value.trim();
      const isGroup = isGroupCheckbox?.checked || false;
      const groupEmails = newGroupEmailsInput?.value.trim() || '';

      if (!name) {
        showToast('נא להזין כינוי ליומן (לדוגמה: עבודה נוספת)', 'alert-circle');
        newNameInput.focus();
        return;
      }
      if (!email || !email.includes('@')) {
        showToast('נא להזין כתובת אימייל תקינה', 'alert-circle');
        newEmailInput.focus();
        return;
      }

      const accounts = getStoredAccounts();
      // אם קיים רק יומן ברירת מחדל ריק של משתמש חדש, נחליף אותו ביומן האמיתי הראשון שהזין
      if (accounts.length === 1 && accounts[0].id === 'personal' && !accounts[0].email) {
        accounts[0] = {
          id: 'acc_' + Date.now(),
          name: name,
          email: email,
          isGroup: isGroup,
          groupEmails: isGroup ? groupEmails : ''
        };
        currentAccountKey = accounts[0].id;
        localStorage.setItem('smartcal_account', currentAccountKey);
      } else {
        const newId = 'acc_' + Date.now();
        accounts.push({
          id: newId,
          name: name,
          email: email,
          isGroup: isGroup,
          groupEmails: isGroup ? groupEmails : ''
        });
      }

      saveStoredAccounts(accounts);
      newNameInput.value = '';
      newEmailInput.value = '';
      if (newGroupEmailsInput) newGroupEmailsInput.value = '';
      if (isGroupCheckbox) {
        isGroupCheckbox.checked = false;
        groupEmailsCont?.classList.add('hidden');
      }

      renderAccountsManagerList();
      renderAccountButtons();
      showToast(`היומן "${name}" נוסף בהצלחה`, 'check');
    });
  }

  // איפוס חשבונות לברירות מחדל (2יומן)
  const resetAccountsBtn = document.getElementById('resetAccountsDefaultBtn');
  if (resetAccountsBtn) {
    resetAccountsBtn.addEventListener('click', () => {
      saveStoredAccounts(DEFAULT_ACCOUNTS);
      currentAccountKey = DEFAULT_ACCOUNTS[0].id;
      localStorage.setItem('smartcal_account', currentAccountKey);
      renderAccountsManagerList();
      renderAccountButtons();
      showToast('היומנים אופסו לברירות המחדל של 2יומן', 'check');
    });
  }

  const copySetupLinkBtn = document.getElementById('copySetupLinkBtn');
  if (copySetupLinkBtn) {
    copySetupLinkBtn.addEventListener('click', () => {
      const currentKey = apiKeyInput.value.trim() || getApiKey();
      if (currentKey) localStorage.setItem('smartcal_api_key', currentKey);
      const magicUrl = generateShareOrSyncUrl({ includeKey: true, includeAccounts: true, requireKey: true });
      if (!magicUrl) {
        apiKeyInput.focus();
        return;
      }
      navigator.clipboard.writeText(magicUrl).then(() => {
        showToast('קישור הסנכרון האישי הועתק! (מכיל מפתח API - שלח למכשיר שלך בלבד)', 'check');
      }).catch(() => {
        showToast('לא ניתן להעתיק ללוח הגזירים', 'alert-circle');
      });
    });
  }

  const toggleSetupQrBtn = document.getElementById('toggleSetupQrBtn');
  if (toggleSetupQrBtn) {
    toggleSetupQrBtn.addEventListener('click', () => {
      const currentKey = apiKeyInput.value.trim() || getApiKey();
      if (currentKey) localStorage.setItem('smartcal_api_key', currentKey);
      modal.classList.add('hidden');
      openDedicatedQrModal('personal');
    });
  }
}

// --- 13ב. מנגנון שיתוף מבוקר (Safe Share לחברים מול סנכרון אישי מוגן) ---
let qrShareMode = 'safe'; // 'safe' (ללא מפתח - ברירת מחדל) | 'personal' (סנכרון למכשיר שלי)
let qrPersonalIncludeAccounts = true;
let qrPersonalIncludeApiKey = false; // כבוי כברירת מחדל להגנה מקסימלית עד סימון מפורש

function getCleanPublicAppUrl() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return isLocal
    ? 'https://dymvie-alt.github.io/smartcal-linker/'
    : (window.location.origin + window.location.pathname);
}

// בניית קישור שיתוף נקי (למשתמש חדש) או קישור סנכרון אישי (#setup=...)
function generateShareOrSyncUrl({ includeKey = false, includeAccounts = false, requireKey = false } = {}) {
  const baseUrl = getCleanPublicAppUrl();

  // במצב שיתוף נקי לחברים - תמיד מחזיר כתובת נקייה ב-100% ללא שום מידע אישי!
  if (!includeKey && !includeAccounts) {
    return baseUrl;
  }

  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  const currentKey = (apiKeyInput?.value?.trim()) || getApiKey();

  if (requireKey && includeKey && !currentKey) {
    showToast('נא להזין תחילה מפתח Gemini API לפני יצירת קישור סנכרון עם מפתח', 'alert-circle');
    return null;
  }

  const payload = {};
  if (includeKey && currentKey) {
    payload.k = currentKey;
  }
  const currentMod = modelSelect?.value || getModel();
  if (includeKey && currentMod && currentMod !== 'gemini-3.8-flash') {
    payload.m = currentMod;
  }
  if (includeAccounts) {
    const storedAccs = getStoredAccounts();
    if (storedAccs.length > 0) {
      payload.a = storedAccs;
    }
    if (currentAccountKey) {
      payload.c = currentAccountKey;
    }
  }

  if (Object.keys(payload).length === 0) {
    return baseUrl;
  }

  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${baseUrl}#setup=${encoded}`;
}

// פתיחת חלון ה-QR והשיתוף (ברירת מחדל: מצב 'safe' נקי לחלוטין ממפתח API!)
function openDedicatedQrModal(initialMode = 'safe') {
  const qrModal = document.getElementById('mobileQrModal');
  if (!qrModal) return;

  qrShareMode = initialMode === 'personal' ? 'personal' : 'safe';
  // גם כשנכנסים למצב אישי, נאפשר שליטה מלאה בצ'קבוקסים
  qrPersonalIncludeAccounts = true;
  qrPersonalIncludeApiKey = initialMode === 'personal' && !!getApiKey();

  updateQrModeTabsUI();
  renderDedicatedQrCode();
  qrModal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function updateQrModeTabsUI() {
  const safeBtn = document.getElementById('qrModeSafeBtn');
  const personalBtn = document.getElementById('qrModePersonalBtn');
  if (!safeBtn || !personalBtn) return;

  if (qrShareMode === 'safe') {
    safeBtn.className = 'py-2 px-2 rounded-lg font-bold bg-white text-emerald-700 shadow-xs transition-all flex items-center justify-center gap-1.5';
    personalBtn.className = 'py-2 px-2 rounded-lg font-semibold text-gray-600 hover:text-gray-900 transition-all flex items-center justify-center gap-1.5';
  } else {
    personalBtn.className = 'py-2 px-2 rounded-lg font-bold bg-white text-amber-800 shadow-xs transition-all flex items-center justify-center gap-1.5';
    safeBtn.className = 'py-2 px-2 rounded-lg font-semibold text-gray-600 hover:text-gray-900 transition-all flex items-center justify-center gap-1.5';
  }
}

function getActiveQrUrl() {
  if (qrShareMode === 'safe') {
    return getCleanPublicAppUrl();
  }
  return generateShareOrSyncUrl({
    includeKey: qrPersonalIncludeApiKey,
    includeAccounts: qrPersonalIncludeAccounts,
    requireKey: false
  });
}

function renderDedicatedQrCode() {
  const banner = document.getElementById('qrKeyStatusBanner');
  const canvasBox = document.getElementById('dedicatedQrCanvas');
  const captionEl = document.getElementById('qrCaptionText');
  const copyBtnText = document.getElementById('copyQrLinkBtnText');
  const waBtnText = document.getElementById('shareWhatsAppBtnText');
  const footerBox = document.getElementById('qrFooterHelpBox');
  if (!banner || !canvasBox) return;

  if (qrShareMode === 'safe') {
    // מצב 1 (ברירת מחדל): שיתוף בטוח לחבר ללא מפתח API וללא יומנים אישיים
    banner.className = 'rounded-xl p-3 text-xs border bg-emerald-50/90 border-emerald-200 text-emerald-950 space-y-1';
    banner.innerHTML = `
      <div class="font-bold flex items-center gap-1.5 text-emerald-900">
        <i data-lucide="shield-check" class="w-4 h-4 text-emerald-600 shrink-0"></i>
        <span>שיתוף מוגן לחברים ומשתמשים חדשים (ללא מפתח API)</span>
      </div>
      <p class="text-[11px] text-emerald-800 leading-relaxed">
        הקישור והברקוד שלהלן <strong>נקיים לחלוטין</strong>. מפתח ה-API האישי שלך והיומנים שלך נשארים אצלך בלבד, והמשתמש החדש יתבקש להזין מפתח חינמי משלו.
      </p>
    `;
    if (captionEl) captionEl.textContent = 'סרוק לפתיחת האפליקציה הנקייה (ללא חשיפת המפתח שלך)';
    if (copyBtnText) copyBtnText.textContent = 'העתק קישור נקי לאפליקציה';
    if (waBtnText) waBtnText.textContent = 'שלח הזמנה בוואטסאפ לחבר';
    if (footerBox) {
      footerBox.innerHTML = `
        <p class="font-bold text-gray-800">מה יראה החבר שיקבל את הקישור?</p>
        <p>1. האפליקציה תיפתח אצלו נקייה לחלוטין (ללא המפתח וללא המיילים שלך).</p>
        <p>2. יופיע לו אשף קצר של 30 שניות להוצאת מפתח חינמי משלו מ-Google והגדרת היומן האישי שלו.</p>
      `;
    }
  } else {
    // מצב 2: סנכרון אישי למכשיר שלי (כולל בחירה מפורשת של יומנים ומפתח API)
    const hasKey = !!getApiKey();
    banner.className = 'rounded-xl p-3 text-xs border bg-amber-50/90 border-amber-200 text-amber-950 space-y-2';
    banner.innerHTML = `
      <div class="font-bold flex items-center gap-1.5 text-amber-900">
        <i data-lucide="lock" class="w-4 h-4 text-amber-600 shrink-0"></i>
        <span>סנכרון אישי למכשיר שלך / מעגל מורשה בלבד:</span>
      </div>
      <div class="space-y-1.5 pt-0.5">
        <label class="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-gray-800">
          <input type="checkbox" id="qrIncludeAccountsCheck" class="rounded text-blue-600 w-3.5 h-3.5" ${qrPersonalIncludeAccounts ? 'checked' : ''}>
          <span>כלול את רשימת היומנים שלי (${getStoredAccounts().length} יומנים)</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-[11px] font-semibold ${hasKey ? 'text-red-800' : 'text-gray-400'}">
          <input type="checkbox" id="qrIncludeApiKeyCheck" class="rounded text-red-600 w-3.5 h-3.5" ${qrPersonalIncludeApiKey && hasKey ? 'checked' : ''} ${!hasKey ? 'disabled' : ''}>
          <span>כלול את מפתח ה-API האישי שלי ${hasKey ? '(אזהרה: אל תשתף עם זרים!)' : '(לא מוגדר כרגע מפתח)'}</span>
        </label>
      </div>
    `;

    const accCheck = banner.querySelector('#qrIncludeAccountsCheck');
    const keyCheck = banner.querySelector('#qrIncludeApiKeyCheck');
    accCheck?.addEventListener('change', (e) => {
      qrPersonalIncludeAccounts = e.target.checked;
      renderDedicatedQrCode();
    });
    keyCheck?.addEventListener('change', (e) => {
      qrPersonalIncludeApiKey = e.target.checked;
      renderDedicatedQrCode();
    });

    if (captionEl) {
      captionEl.textContent = qrPersonalIncludeApiKey
        ? '⚠️ ברקוד זה מכיל את מפתח ה-API האישי שלך — סרוק במכשיר שלך בלבד!'
        : 'סרוק להעברת רשימת היומנים שלך (ללא מפתח API)';
    }
    if (copyBtnText) {
      copyBtnText.textContent = qrPersonalIncludeApiKey ? 'העתק קישור סנכרון אישי (כולל מפתח)' : 'העתק קישור יומנים בלבד';
    }
    if (waBtnText) {
      waBtnText.textContent = 'שלח קישור סנכרון לעצמי בוואטסאפ';
    }
    if (footerBox) {
      footerBox.innerHTML = `
        <p class="font-bold text-gray-800">איך שומרים כאפליקציה בטלפון האישי שלך?</p>
        <p>1. סרוק את הברקוד עם מצלמת הטלפון שלך — ההגדרות שבחרת יוטמעו אוטומטית.</p>
        <p>2. בטלפון, לחץ על <strong>"הוסף למסך הבית"</strong> בראש הדף.</p>
      `;
    }
  }

  const targetUrl = getActiveQrUrl();
  if (typeof window.qrcode === 'function' && targetUrl) {
    try {
      const qr = window.qrcode(0, 'L');
      qr.addData(targetUrl);
      qr.make();
      canvasBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      const svgEl = canvasBox.querySelector('svg');
      if (svgEl) {
        svgEl.style.width = '195px';
        svgEl.style.height = '195px';
      }
    } catch (err) {
      console.error('QR generation error:', err);
      canvasBox.innerHTML = '<p class="text-xs text-red-600 p-4">שגיאה ביצירת QR. השתמש בכפתור העתקת הקישור למטה.</p>';
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// --- 13ג. אשף כניסה למשתמש חדש (Onboarding) ומודל עזרה ומדריך (?) ---
function openOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;

  const keyInput = document.getElementById('onboardingApiKeyInput');
  if (keyInput) keyInput.value = getApiKey();

  const accounts = getStoredAccounts();
  const firstAcc = accounts[0];
  const nameInput = document.getElementById('onboardingUserNameInput');
  const emailInput = document.getElementById('onboardingUserEmailInput');
  if (nameInput && firstAcc && firstAcc.id === 'personal') {
    nameInput.value = firstAcc.name === 'היומן האישי שלי' ? '' : firstAcc.name;
  }
  if (emailInput && firstAcc && firstAcc.email && firstAcc.id === 'personal') {
    emailInput.value = firstAcc.email;
  }

  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function openHelpModal() {
  const modal = document.getElementById('helpModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function setupOnboardingAndHelpModals() {
  const onboardingModal = document.getElementById('onboardingModal');
  const closeOnboardingBtn = document.getElementById('closeOnboardingBtn');
  const skipOnboardingBtn = document.getElementById('skipOnboardingBtn');
  const completeOnboardingBtn = document.getElementById('completeOnboardingBtn');
  const openHelpFromOnboardingBtn = document.getElementById('openHelpFromOnboardingBtn');

  const helpModal = document.getElementById('helpModal');
  const openHelpBtn = document.getElementById('openHelpBtn');
  const closeHelpBtn = document.getElementById('closeHelpBtn');
  const closeHelpBottomBtn = document.getElementById('closeHelpBottomBtn');
  const openOnboardingFromHelpBtn = document.getElementById('openOnboardingFromHelpBtn');

  closeOnboardingBtn?.addEventListener('click', () => onboardingModal?.classList.add('hidden'));
  skipOnboardingBtn?.addEventListener('click', () => onboardingModal?.classList.add('hidden'));
  onboardingModal?.addEventListener('click', (e) => {
    if (e.target === onboardingModal) onboardingModal.classList.add('hidden');
  });

  if (completeOnboardingBtn) {
    completeOnboardingBtn.addEventListener('click', () => {
      const keyInput = document.getElementById('onboardingApiKeyInput');
      const nameInput = document.getElementById('onboardingUserNameInput');
      const emailInput = document.getElementById('onboardingUserEmailInput');

      const key = (keyInput?.value || '').trim();
      if (!isValidGeminiApiKey(key)) {
        showToast('נא להדביק מפתח Gemini API תקין (מתחיל ב-AIzaSy)', 'alert-circle');
        keyInput?.focus();
        return;
      }

      localStorage.setItem('smartcal_api_key', key);

      // אם המשתמש החדש הזין שם או כתובת Gmail אישית, נעדכן עבורו את יומן היעד האישי
      const userName = (nameInput?.value || '').trim();
      const userEmail = (emailInput?.value || '').trim();
      let accounts = getStoredAccounts();

      if (userEmail && userEmail.includes('@')) {
        const displayName = userName ? `${userName} (אישי)` : 'היומן האישי שלי';
        if (accounts.length === 1 && accounts[0].id === 'personal') {
          accounts[0] = { id: 'personal', name: displayName, email: userEmail, isGroup: false };
        } else if (!accounts.some(a => a.email.toLowerCase() === userEmail.toLowerCase())) {
          const newId = 'acc_' + Date.now();
          accounts.unshift({ id: newId, name: displayName, email: userEmail, isGroup: false });
          currentAccountKey = newId;
          localStorage.setItem('smartcal_account', currentAccountKey);
        }
        saveStoredAccounts(accounts);
        renderAccountButtons();
      }

      backupConfigToCacheStorage({
        k: key,
        m: getModel(),
        a: getStoredAccounts(),
        c: currentAccountKey
      });

      onboardingModal?.classList.add('hidden');
      showToast('המפתח האישי נשמר בהצלחה! כעת ניתן לחלץ אירועים', 'check');
    });
  }

  openHelpBtn?.addEventListener('click', openHelpModal);
  closeHelpBtn?.addEventListener('click', () => helpModal?.classList.add('hidden'));
  closeHelpBottomBtn?.addEventListener('click', () => helpModal?.classList.add('hidden'));
  helpModal?.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.add('hidden');
  });

  openHelpFromOnboardingBtn?.addEventListener('click', () => {
    onboardingModal?.classList.add('hidden');
    openHelpModal();
  });

  openOnboardingFromHelpBtn?.addEventListener('click', () => {
    helpModal?.classList.add('hidden');
    openOnboardingModal();
  });
}

// שמירה וגיבוי של ההגדרות גם ב-CacheStorage כדי שאפליקציית מסך הבית בנייד תשתף אותן
async function backupConfigToCacheStorage(payload) {
  try {
    if ('caches' in window) {
      const cache = await caches.open('smartcal-config-backup-v1');
      const res = new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put('/__smartcal_saved_config__', res);
    }
  } catch (e) {}
}

async function restoreConfigFromCacheStorageIfNeeded() {
  try {
    if (!getApiKey() && 'caches' in window) {
      const cache = await caches.open('smartcal-config-backup-v1');
      const res = await cache.match('/__smartcal_saved_config__');
      if (res) {
        const payload = await res.json();
        if (payload && payload.k) {
          localStorage.setItem('smartcal_api_key', payload.k);
          if (payload.m) localStorage.setItem('smartcal_model', payload.m);
          if (Array.isArray(payload.a) && payload.a.length > 0) saveStoredAccounts(payload.a);
          if (payload.c) {
            currentAccountKey = payload.c;
            localStorage.setItem('smartcal_account', payload.c);
            renderAccountButtons();
          }
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

// קליטת קישור סנכרון מהיר (#setup=...) בטעינת הדף וניקוי מיידי משורת הכתובת
function checkMagicSetupHash() {
  try {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith('#setup=')) {
      restoreConfigFromCacheStorageIfNeeded();
      return;
    }

    const encoded = hash.slice('#setup='.length);
    const jsonStr = decodeURIComponent(escape(atob(encoded)));
    const payload = JSON.parse(jsonStr);

    if (payload && typeof payload === 'object') {
      if (payload.k) localStorage.setItem('smartcal_api_key', payload.k);
      if (payload.m) localStorage.setItem('smartcal_model', payload.m);
      if (Array.isArray(payload.a) && payload.a.length > 0) {
        saveStoredAccounts(payload.a);
      }
      if (payload.c) {
        currentAccountKey = payload.c;
        localStorage.setItem('smartcal_account', payload.c);
      }

      // גיבוי ל-CacheStorage כדי שגם פתיחה ממסך הבית בנייד תכיר את המפתח מיד
      backupConfigToCacheStorage(payload);

      // מחיקה מיידית של ה-Hash משורת הכתובת ומההיסטוריה למניעת חשיפת המפתח
      history.replaceState(null, '', window.location.pathname + window.location.search);

      setTimeout(() => {
        showToast('ההגדרות סונכרנו למכשיר זה בהצלחה!', 'check');
      }, 400);
    }
  } catch (err) {
    console.warn('שגיאה בפענוח קישור סנכרון:', err);
  }
}

// קליטת תוכן ששותף מהטלפון דרך תפריט ה-Share (Web Share Target API)
function checkSharedIncomingContent() {
  try {
    const params = new URLSearchParams(window.location.search);
    const sharedTitle = params.get('title') || '';
    const sharedText = params.get('text') || '';
    const sharedUrl = params.get('url') || '';

    if (!sharedTitle && !sharedText && !sharedUrl) return;

    const combined = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n');
    const textInput = document.getElementById('textInput');
    if (textInput && combined) {
      textInput.value = combined;
      autoResizeTextarea(textInput);

      // ניקוי שורת הכתובת
      history.replaceState(null, '', window.location.pathname);

      // אם כבר מוגדר מפתח API במכשיר, נפעיל את החילוץ אוטומטית!
      if (getApiKey()) {
        setTimeout(() => {
          handleParseRequest();
        }, 350);
      } else {
        openOnboardingModal();
        showToast('התוכן שותף! הגדר מפתח API אישי כדי לחלץ את האירוע', 'info');
      }
    }
  } catch (err) {
    console.warn('שגיאה בקליטת שיתוף:', err);
  }
}

// ניהול חלון ה-QR והשיתוף המאובטח, התקנת PWA בנייד בלבד, והדבקת תמונה ישירה (Ctrl+V)
function setupPwaInstallAndGlobalPaste() {
  const openQrHeaderBtn = document.getElementById('openQrHeaderBtn');
  const qrModal = document.getElementById('mobileQrModal');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');
  const qrModeSafeBtn = document.getElementById('qrModeSafeBtn');
  const qrModePersonalBtn = document.getElementById('qrModePersonalBtn');
  const copyDedicatedQrLinkBtn = document.getElementById('copyDedicatedQrLinkBtn');
  const shareWhatsAppAppBtn = document.getElementById('shareWhatsAppAppBtn');
  const installBtn = document.getElementById('installPwaBtn');

  if (openQrHeaderBtn) {
    openQrHeaderBtn.addEventListener('click', () => openDedicatedQrModal('safe'));
  }
  if (qrModeSafeBtn) {
    qrModeSafeBtn.addEventListener('click', () => {
      qrShareMode = 'safe';
      updateQrModeTabsUI();
      renderDedicatedQrCode();
    });
  }
  if (qrModePersonalBtn) {
    qrModePersonalBtn.addEventListener('click', () => {
      qrShareMode = 'personal';
      updateQrModeTabsUI();
      renderDedicatedQrCode();
    });
  }
  if (closeQrModalBtn && qrModal) {
    closeQrModalBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
  }
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.classList.add('hidden');
    });
  }
  if (copyDedicatedQrLinkBtn) {
    copyDedicatedQrLinkBtn.addEventListener('click', () => {
      const targetUrl = getActiveQrUrl();
      if (!targetUrl) return;
      navigator.clipboard.writeText(targetUrl).then(() => {
        const msg = qrShareMode === 'safe'
          ? 'קישור נקי לאפליקציה הועתק! בטוח לשליחה לכל חבר (ללא המפתח שלך)'
          : 'קישור הסנכרון האישי הועתק ללוח!';
        showToast(msg, 'check');
      }).catch(() => {
        showToast('לא ניתן להעתיק ללוח הגזירים', 'alert-circle');
      });
    });
  }
  if (shareWhatsAppAppBtn) {
    shareWhatsAppAppBtn.addEventListener('click', () => {
      const targetUrl = getActiveQrUrl();
      if (!targetUrl) return;
      let waText = '';
      if (qrShareMode === 'safe') {
        waText = [
          'היי! שיתפתי איתך את *SmartCal Linker (יומן חכם)* 🗓️✨',
          'אפליקציה שהופכת כל הודעת וואטסאפ, לינק, תמונת הזמנה, PDF או הקלטה קולית לאירוע מוכן ביומן Google בלחיצה אחת.',
          '',
          `🔗 כניסה לאפליקציה: ${targetUrl}`,
          '',
          '💡 בכניסה הראשונה יופיע לך אשף קצר (30 שניות) להוצאת מפתח Gemini AI אישי וחינמי משלך מ-Google.'
        ].join('\n');
      } else {
        waText = `קישור סנכרון אישי ל-SmartCal Linker:\n${targetUrl}`;
      }
      const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
      window.open(waUrl, '_blank');
    });
  }

  let deferredPrompt = null;
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // הצגת כפתור "הוסף למסך הבית" אך ורק במכשירים ניידים (למניעת התקנת אפליקציית דסקטופ מקומית בטעות במחשב)
  if (isIos && !isStandalone && installBtn) {
    installBtn.classList.remove('hidden');
    installBtn.classList.add('inline-flex');
    installBtn.addEventListener('click', () => {
      showToast('באייפון: לחץ על כפתור ה"שיתוף" בתחתית הדפדפן ובחר "הוסף למסך הבית"', 'info');
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (isMobileDevice && installBtn && !isStandalone) {
      installBtn.classList.remove('hidden');
      installBtn.classList.add('inline-flex');
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installBtn.classList.add('hidden');
        showToast('האפליקציה נוספה למסך הבית בנייד!', 'check');
      }
      deferredPrompt = null;
    });
  }

  // קיצור מקלדת גלובלי: Escape לסגירת כל חלון מודאלי פתוח
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['mobileQrModal', 'confirmResetModal', 'historyModal', 'settingsModal', 'onboardingModal', 'helpModal'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
          el.classList.add('hidden');
        }
      });
    }
  });

  // הדבקת תמונה גלובלית (צילום מסך מלוח הגזירים)
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          document.getElementById('tabImage')?.click();
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          const fileInput = document.getElementById('imageFileInput');
          if (fileInput) {
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
          }
          break;
        }
      }
    }
  });
}

function renderAccountsManagerList() {
  const container = document.getElementById('accountsManagerList');
  if (!container) return;

  const accounts = getStoredAccounts();
  container.innerHTML = '';

  accounts.forEach((acc, idx) => {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200 text-xs';

    const groupBadge = acc.isGroup 
      ? '<span class="text-[10px] bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded mr-1">קבוצה</span>' 
      : '';

    item.innerHTML = `
      <div class="truncate pr-1">
        <div class="flex items-center gap-1 font-semibold text-gray-800">
          <span>${acc.name}</span>
          ${groupBadge}
        </div>
        <div class="text-[11px] text-gray-500 font-mono truncate" dir="ltr">${acc.email || ''}</div>
      </div>
      <button type="button" class="del-acc-btn p-1 text-gray-400 hover:text-red-600 rounded-lg transition-colors ${accounts.length <= 1 ? 'opacity-30 cursor-not-allowed' : ''}" data-idx="${idx}" title="מחק יומן" ${accounts.length <= 1 ? 'disabled' : ''}>
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    `;

    item.querySelector('.del-acc-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (accounts.length <= 1) {
        showToast('לא ניתן למחוק את החשבון האחרון', 'alert-circle');
        return;
      }
      accounts.splice(idx, 1);
      saveStoredAccounts(accounts);
      if (currentAccountKey === acc.id) {
        currentAccountKey = accounts[0].id;
        localStorage.setItem('smartcal_account', currentAccountKey);
      }
      renderAccountsManagerList();
      renderAccountButtons();
      showToast(`היומן "${acc.name}" נמחק`, 'check');
    });

    container.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons();
}

// --- 14. ניהול היסטוריית אירועים (Event History) ---
function getHistory() {
  try {
    const raw = localStorage.getItem('smartcal_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveToHistory(eventData) {
  if (!eventData || !eventData.title) return;
  let history = getHistory();

  // אם קיים כבר אירוע זהה עם אותה כותרת ואותו תאריך, נסיר כדי להציב עדכני בראש
  history = history.filter(item => !(item.title === eventData.title && item.startDate === eventData.startDate));

  const historyItem = {
    ...eventData,
    historyId: 'hist_' + Date.now(),
    savedAt: new Date().toISOString()
  };

  history.unshift(historyItem);
  if (history.length > 15) {
    history = history.slice(0, 15);
  }

  localStorage.setItem('smartcal_history', JSON.stringify(history));
  updateHistoryBadge();
}

function removeFromHistory(historyId) {
  let history = getHistory();
  history = history.filter(item => item.historyId !== historyId);
  localStorage.setItem('smartcal_history', JSON.stringify(history));
  updateHistoryBadge();
  renderHistoryModal();
  showToast('האירוע נמחק מההיסטוריה', 'check');
}

function clearAllHistory() {
  localStorage.removeItem('smartcal_history');
  updateHistoryBadge();
  renderHistoryModal();
  showToast('כל ההיסטוריה נוקתה בהצלחה', 'check');
}

function updateHistoryBadge() {
  const badge = document.getElementById('historyBadge');
  const countBadge = document.getElementById('historyCountBadge');
  const history = getHistory();

  if (badge) {
    if (history.length > 0) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if (countBadge) {
    countBadge.textContent = history.length;
  }
}

function setupHistoryModal() {
  const modal = document.getElementById('historyModal');
  const openBtn = document.getElementById('openHistoryBtn');
  const closeBtn = document.getElementById('closeHistoryBtn');
  const closeBottomBtn = document.getElementById('closeHistoryBottomBtn');
  const clearBtn = document.getElementById('clearAllHistoryBtn');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      renderHistoryModal();
      modal?.classList.remove('hidden');
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', () => modal?.classList.add('hidden'));
  if (closeBottomBtn) closeBottomBtn.addEventListener('click', () => modal?.classList.add('hidden'));
  if (clearBtn) clearBtn.addEventListener('click', clearAllHistory);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  updateHistoryBadge();
}

function renderHistoryModal() {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  const history = getHistory();
  if (history.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center space-y-2 text-gray-400">
        <div class="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
          <i data-lucide="calendar" class="w-6 h-6"></i>
        </div>
        <p class="font-semibold text-gray-600 text-xs">אין אירועים בהיסטוריה עדיין</p>
        <p class="text-[11px] text-gray-400 max-w-xs mx-auto">כל אירוע שתחלץ, תפתח ביומן או תוריד יישמר כאן אוטומטית לעיון מהיר.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bg-gray-50/90 hover:bg-white rounded-xl p-3 border border-gray-200 transition-all shadow-2xs space-y-2';

    const dateStr = item.startDate ? (item.isAllDay ? item.startDate + ' (יום שלם)' : `${item.startDate} ${item.startTime || ''}`) : '';
    const locationStr = item.location ? `<span class="flex items-center gap-1 text-[11px] text-gray-500 truncate"><i data-lucide="map-pin" class="w-3 h-3 shrink-0 text-gray-400"></i>${item.location}</span>` : '';
    const recurStr = item.recurrence ? `<span class="inline-flex items-center gap-1 text-[11px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md font-medium border border-purple-100"><i data-lucide="repeat" class="w-3 h-3 text-purple-600"></i>${formatRecurrenceHebrew(item.recurrence)}</span>` : '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="truncate">
          <h4 class="font-bold text-gray-900 text-xs truncate">${item.title || 'אירוע ללא שם'}</h4>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md font-medium border border-blue-100">
              <i data-lucide="calendar" class="w-3 h-3"></i>
              ${dateStr}
            </span>
            ${recurStr}
            ${locationStr}
          </div>
        </div>
        <button class="del-history-btn p-1 text-gray-400 hover:text-red-600 rounded-md transition-colors shrink-0" data-id="${item.historyId}" title="מחק מההיסטוריה">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
      <div class="flex items-center justify-end gap-1.5 pt-1.5 border-t border-gray-200/60">
        <button class="load-history-btn text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 font-semibold transition-all flex items-center gap-1 shadow-2xs" data-id="${item.historyId}">
          <i data-lucide="pencil" class="w-3 h-3"></i>
          טען לטופס
        </button>
      </div>
    `;

    card.querySelector('.del-history-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromHistory(item.historyId);
    });

    card.querySelector('.load-history-btn')?.addEventListener('click', () => {
      populateEventForm(item);
      document.getElementById('historyModal')?.classList.add('hidden');
      document.getElementById('resultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('האירוע נטען מההיסטוריה לטופס', 'check');
    });

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

function openSettings() {
  document.getElementById('settingsModal').classList.remove('hidden');
}

function getApiKey() {
  return localStorage.getItem('smartcal_api_key') || '';
}

function getModel() {
  let model = localStorage.getItem('smartcal_model');
  // שדרוג אוטומטי למודל העדכני של גוגל (Gemini 3.8 Flash) אם נשמר מודל שהוצא משימוש
  if (!model || model.includes('2.5') || model.includes('1.5') || model.includes('2.0')) {
    model = 'gemini-3.8-flash';
    localStorage.setItem('smartcal_model', model);
  }
  return model;
}

function loadSavedSettings() {
  const key = getApiKey();
  if (!key) {
    // המתנה קצרה למקרה שמתבצע שחזור מ-CacheStorage, ואם עדיין אין מפתח - פתיחת אשף הכניסה למשתמש חדש
    setTimeout(() => {
      if (!getApiKey()) {
        openOnboardingModal();
      }
    }, 600);
  }
}

// --- 14. עזרי ממשק (Loading, Toast) ---
function setLoadingMessage(title, sub) {
  const loadingTitle = document.getElementById('loadingTitle');
  const loadingSub = document.getElementById('loadingSub');
  if (loadingTitle && title) loadingTitle.textContent = title;
  if (loadingSub && sub) loadingSub.textContent = sub;
}

function setLoadingState(isLoading) {
  const loadingEl = document.getElementById('loadingState');
  const parseBtn = document.getElementById('parseEventBtn');
  const btnText = document.getElementById('parseBtnText');

  if (isLoading) {
    loadingEl.classList.remove('hidden');
    parseBtn.disabled = true;
    btnText.textContent = 'מעבד נתונים...';
  } else {
    loadingEl.classList.add('hidden');
    parseBtn.disabled = false;
    btnText.textContent = 'חלץ פרטים וצור אירוע';
  }
}

function showToast(message, iconName = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');
  const undoBtn = document.getElementById('toastUndoBtn');

  if (!toast) return;

  toastMsg.textContent = message;
  toastIcon.setAttribute('data-lucide', iconName);
  if (undoBtn) {
    undoBtn.classList.add('hidden');
    undoBtn.classList.remove('flex');
  }

  if (window.lucide) window.lucide.createIcons();

  toast.classList.remove('hidden');
  toast.classList.add('flex');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('flex');
  }, 3200);
}

// הצגת הודעה מלווה בכפתור שחזור Undo
function showToastWithUndo(message, onUndo) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');
  const undoBtn = document.getElementById('toastUndoBtn');

  if (!toast) return;

  toastMsg.textContent = message;
  toastIcon.setAttribute('data-lucide', 'rotate-ccw');

  if (undoBtn && typeof onUndo === 'function') {
    undoBtn.classList.remove('hidden');
    undoBtn.classList.add('flex');
    undoBtn.onclick = (e) => {
      e.stopPropagation();
      toast.classList.add('hidden');
      toast.classList.remove('flex');
      undoBtn.classList.add('hidden');
      onUndo();
    };
  }

  if (window.lucide) window.lucide.createIcons();

  toast.classList.remove('hidden');
  toast.classList.add('flex');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('flex');
    if (undoBtn) {
      undoBtn.classList.add('hidden');
      undoBtn.classList.remove('flex');
    }
  }, 7000); // 7 שניות לביטול
}
