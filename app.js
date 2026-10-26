/**
 * SmartCal Linker - יומן חכם (קובץ לוגיקה ראשי)
 * מיועד להמרת קלט מולטימודלי (טקסט, תמונה, PDF, קול) לקישור יומן גוגל וקובץ ICS
 */

// --- 1. הגדרות וחשבונות ידועים (תובנות 2יומן) ---
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

function getStoredAccounts() {
  try {
    const raw = localStorage.getItem('smartcal_accounts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  localStorage.setItem('smartcal_accounts', JSON.stringify(DEFAULT_ACCOUNTS));
  return [...DEFAULT_ACCOUNTS];
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

// נתוני האירוע שחולצו
let currentParsedEvent = null;

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
  setupPwaInstallAndGlobalPaste();

  // קליטת תוכן ששותף מהנייד באמצעות Web Share Target (?text=...&url=...)
  checkSharedIncomingContent();
});

// --- 3. ניהול סרגל החשבונות הדינמי של 2יומן ---
function setupAccountSelector() {
  renderAccountButtons();
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
      btn.className = 'account-btn active px-3 py-1.5 rounded-xl border border-blue-600 bg-blue-50 text-blue-700 font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 shadow-xs shrink-0 text-xs';
    } else {
      btn.className = 'account-btn px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 text-xs';
    }

    const iconSvg = acc.isGroup 
      ? '<i data-lucide="users" class="w-3.5 h-3.5 text-blue-600"></i>' 
      : '<i data-lucide="user" class="w-3.5 h-3.5 text-gray-400"></i>';
    btn.innerHTML = `${iconSvg}<span>${acc.name}</span>`;

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
    label.textContent = activeAcc.name;
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
      textInput.focus();
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
    showToast('נא להזין תחילה מפתח Gemini API בהגדרות', 'alert-circle');
    openSettings();
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
    populateEventForm(result);
    showToast('פרטי האירוע חולצו בהצלחה!', 'check');
    // גלילה חלקה אל כרטיס התוצאה
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('שגיאה בעיבוד ה-AI:', error);
    showToast(`שגיאה בפענוח: ${error.message || 'אנא נסה שוב'}`, 'alert-circle');
  } finally {
    setLoadingState(false);
  }
}

// קריאה ישירה ל-Google Gemini API עם Structured Outputs (JSON Schema)
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
7. חזרתיות (recurrence): אם מוזכר שהאירוע קבוע או חוזר (למשל "כל יום שלישי", "מפגש שבועי", "מדי חודש", "יומי"), ציין מחרוזת RRULE מתאימה (למשל: "RRULE:FREQ=WEEKLY", "RRULE:FREQ=DAILY", "RRULE:FREQ=MONTHLY"). אם זה אירוע חד-פעמי, החזר מחרוזת ריקה ("").
8. אזורי זמן זרים: אם שעת האירוע מצוינת באזור זמן זר (למשל EST, PST, GMT, CET), תרגם את השעות לזמן ישראל (${timeZone}) וציין בהערות את שעת המקור ואזור הזמן המקורי.
`.trim();

  const responseSchema = {
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

// --- 10. הזנת נתונים לטופס העריכה ---
function populateEventForm(data) {
  // נירמול זמנים קשיח
  let cleanStartTime = '';
  let cleanEndTime = '';

  if (!data.isAllDay) {
    cleanStartTime = normalizeTime(data.startTime, '10:00');
    cleanEndTime = normalizeTime(data.endTime);
    if (!cleanEndTime && cleanStartTime) {
      const [h, m] = cleanStartTime.split(':').map(Number);
      const endH = (h + 1) % 24;
      cleanEndTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  data.startTime = cleanStartTime;
  data.endTime = cleanEndTime;

  currentParsedEvent = { ...data };

  document.getElementById('eventTitle').value = data.title || '';
  const isAllDayCheckbox = document.getElementById('eventIsAllDay');
  isAllDayCheckbox.checked = !!data.isAllDay;

  document.getElementById('eventStartDate').value = data.startDate || '';
  document.getElementById('eventStartTime').value = cleanStartTime;
  
  document.getElementById('eventEndDate').value = data.endDate || data.startDate || '';
  document.getElementById('eventEndTime').value = cleanEndTime;

  // הגדרה וסנכרון ויזואלי של שדה החזרתיות (כולל תגית בולטת בראש הכרטיס)
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
  saveToHistory(currentParsedEvent);

  // הצגת הכרטיס
  document.getElementById('resultCard').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
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

  // כפתור הורדת קובץ ICS
  document.getElementById('downloadIcsBtn').addEventListener('click', handleDownloadIcs);

  // כפתור העתקת קישור
  document.getElementById('copyLinkBtn').addEventListener('click', handleCopyDirectLink);
}

// בדיקה חכמה לפני איפוס: האם האירוע כבר נשמר/יוצא?
function requestNewEvent() {
  if (!currentParsedEvent || hasExported) {
    // האירוע כבר נשמר או שאין תוכן פעיל - מנקים מיד ללא חלון מעכב!
    executeResetForNewEvent();
  } else {
    // האירוע טרם נשמר - מציגים חלון אזהרה מעוצב
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
      const addBtn = document.getElementById('addToGoogleBtn');
      if (addBtn && addBtn.href) {
        window.open(addBtn.href, '_blank');
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

// ביצוע איפוס מלא של הדף + יצירת נקודת שחזור (Undo)
function executeResetForNewEvent() {
  // שמירת מצב קודם למקרה שהמשתמש ירצה לבטל מחיקה
  if (currentParsedEvent) {
    lastClearedState = {
      parsedEvent: JSON.parse(JSON.stringify(currentParsedEvent)),
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

  // 5. איפוס כרטיס תוצאה
  currentParsedEvent = null;
  hasExported = false;
  document.getElementById('eventForm')?.reset();
  setRecurrenceValue('');
  const descEl = document.getElementById('eventDescription');
  if (descEl) descEl.style.height = 'auto';
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

// שחזור הנתונים שנמחקו (Undo)
function restoreLastClearedState() {
  if (!lastClearedState) return;

  if (lastClearedState.textVal) {
    const textInput = document.getElementById('textInput');
    if (textInput) {
      textInput.value = lastClearedState.textVal;
      autoResizeTextarea(textInput);
    }
  }

  if (lastClearedState.parsedEvent) {
    populateEventForm(lastClearedState.parsedEvent);
    document.getElementById('resultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('האירוע שוחזר בהצלחה!', 'check');
  }

  lastClearedState = null;
}

function readFormDataAndUpdateLinks() {
  hasExported = false; // שינוי ידני של נתונים שטרם נשמרו ביומן
  const isAllDay = document.getElementById('eventIsAllDay').checked;
  const attendeesRaw = document.getElementById('eventAttendees').value;
  const attendees = attendeesRaw ? attendeesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  currentParsedEvent = {
    title: document.getElementById('eventTitle').value,
    isAllDay: isAllDay,
    startDate: document.getElementById('eventStartDate').value,
    startTime: document.getElementById('eventStartTime').value,
    endDate: document.getElementById('eventEndDate').value,
    endTime: document.getElementById('eventEndTime').value,
    recurrence: document.getElementById('eventRecurrence')?.value || '',
    location: document.getElementById('eventLocation').value,
    description: document.getElementById('eventDescription').value,
    attendees: attendees
  };

  refreshCalendarLinks();
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

  // 1. טיפול בתאריכים לפי יום שלם מול שעה מוגדרת
  let datesParam = '';

  if (ev.isAllDay) {
    // ביום שלם בגוגל: YYYYMMDD/YYYYMMDD (תאריך הסיום הוא בלעדי, קרי יום אחד אחרי תאריך הסיום האמיתי)
    const startClean = ev.startDate.replace(/-/g, '');
    let endObj = new Date(ev.endDate || ev.startDate);
    endObj.setDate(endObj.getDate() + 1); // +1 יום לפרוטוקול גוגל
    const endClean = endObj.toISOString().slice(0, 10).replace(/-/g, '');
    datesParam = `${startClean}/${endClean}`;
  } else {
    // עם שעה: המרה מדויקת ל-UTC (YYYYMMDDTHHmmssZ)
    const startIso = `${ev.startDate}T${ev.startTime || '10:00'}:00`;
    const endIso = `${ev.endDate || ev.startDate}T${ev.endTime || '11:00'}:00`;

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

  // עדכון כפתור ה-Google Calendar
  const addBtn = document.getElementById('addToGoogleBtn');
  if (addBtn) {
    addBtn.href = finalGoogleUrl;
    if (!addBtn._exportClickBound) {
      addBtn._exportClickBound = true;
      addBtn.addEventListener('click', () => {
        hasExported = true;
        saveToHistory(currentParsedEvent);
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

// --- 12. הורדת קובץ יומן (.ICS) ---
function handleDownloadIcs() {
  if (!currentParsedEvent) return;
  hasExported = true;
  const ev = currentParsedEvent;
  saveToHistory(ev);

  let dtStart, dtEnd;
  if (ev.isAllDay) {
    dtStart = `VALUE=DATE:${ev.startDate.replace(/-/g, '')}`;
    let endObj = new Date(ev.endDate || ev.startDate);
    endObj.setDate(endObj.getDate() + 1);
    dtEnd = `VALUE=DATE:${endObj.toISOString().slice(0, 10).replace(/-/g, '')}`;
  } else {
    const s = new Date(`${ev.startDate}T${ev.startTime || '10:00'}:00`);
    const e = new Date(`${ev.endDate || ev.startDate}T${ev.endTime || '11:00'}:00`);
    dtStart = formatDateToUtcString(s);
    dtEnd = formatDateToUtcString(e);
  }

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartCal Linker//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@smartcal.linker`,
    `DTSTAMP:${formatDateToUtcString(new Date())}`,
    `SUMMARY:${ev.title || 'אירוע'}`,
    ev.isAllDay ? `DTSTART;${dtStart}` : `DTSTART:${dtStart}`,
    ev.isAllDay ? `DTEND;${dtEnd}` : `DTEND:${dtEnd}`,
    ev.recurrence ? ev.recurrence : '',
    ev.location ? `LOCATION:${ev.location}` : '',
    ev.description ? `DESCRIPTION:${ev.description.replace(/\n/g, '\\n')}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

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

// העתקת קישור ישיר
function handleCopyDirectLink() {
  const addBtn = document.getElementById('addToGoogleBtn');
  if (addBtn && addBtn.href) {
    hasExported = true;
    if (currentParsedEvent) saveToHistory(currentParsedEvent);
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
  hasExported = true;
  saveToHistory(ev);

  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.id === currentAccountKey) || accounts[0];

  let startIso = '';
  let endIso = '';

  if (ev.isAllDay) {
    startIso = `${ev.startDate}T00:00:00`;
    endIso = `${ev.endDate || ev.startDate}T23:59:59`;
  } else {
    startIso = `${ev.startDate}T${ev.startTime || '10:00'}:00`;
    endIso = `${ev.endDate || ev.startDate}T${ev.endTime || '11:00'}:00`;
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

// --- 13. הגדרות, ניהול מפתח API וניהול יומני יעד ---
function setupSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('openSettingsBtn');
  const closeBtn = document.getElementById('closeSettingsBtn');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');

  openBtn.addEventListener('click', () => {
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

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;
    if (key) {
      localStorage.setItem('smartcal_api_key', key);
    } else {
      localStorage.removeItem('smartcal_api_key');
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
      const newId = 'acc_' + Date.now();
      accounts.push({
        id: newId,
        name: name,
        email: email,
        isGroup: isGroup,
        groupEmails: isGroup ? groupEmails : ''
      });

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

  // איפוס חשבונות לברירות מחדל
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
      const magicUrl = generateMagicSetupUrl(true);
      if (!magicUrl) {
        apiKeyInput.focus();
        return;
      }
      navigator.clipboard.writeText(magicUrl).then(() => {
        showToast('קישור ההגדרה הועתק! שלח לעצמך בוואטסאפ ופתח בנייד', 'check');
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
      openDedicatedQrModal();
    });
  }
}

// בניית קישור סנכרון קומפקטי במיוחד (#setup=...) לקריאה מיידית במצלמת הנייד
function generateMagicSetupUrl(requireKey = false) {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  const currentKey = (apiKeyInput?.value?.trim()) || getApiKey();

  if (requireKey && !currentKey) {
    showToast('נא להזין תחילה מפתח Gemini API לפני יצירת קישור סנכרון', 'alert-circle');
    return null;
  }

  if (currentKey) {
    localStorage.setItem('smartcal_api_key', currentKey);
  }
  const currentMod = modelSelect?.value || getModel();
  if (currentMod) {
    localStorage.setItem('smartcal_model', currentMod);
  }

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const baseUrl = isLocal
    ? 'https://dymvie-alt.github.io/smartcal-linker/'
    : (window.location.origin + window.location.pathname);

  // בניית מטען (Payload) מינימלי כדי שברקוד ה-QR יהיה גדול, חד ונקרא בשבריר שנייה
  const payload = {};
  if (currentKey) payload.k = currentKey;
  if (currentMod && currentMod !== 'gemini-3.8-flash') payload.m = currentMod;
  if (currentAccountKey && currentAccountKey !== 'dim') payload.c = currentAccountKey;

  const storedAccs = getStoredAccounts();
  if (JSON.stringify(storedAccs) !== JSON.stringify(DEFAULT_ACCOUNTS)) {
    payload.a = storedAccs;
  }

  if (Object.keys(payload).length === 0) {
    return baseUrl;
  }

  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${baseUrl}#setup=${encoded}`;
}

// פתיחת חלון ה-QR הייעודי בלחיצה אחת ורינדור ברקוד חד וברור
function openDedicatedQrModal() {
  const qrModal = document.getElementById('mobileQrModal');
  if (!qrModal) return;

  renderDedicatedQrCode();
  qrModal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function renderDedicatedQrCode() {
  const banner = document.getElementById('qrKeyStatusBanner');
  const canvasBox = document.getElementById('dedicatedQrCanvas');
  if (!banner || !canvasBox) return;

  const hasKey = !!getApiKey();
  if (hasKey) {
    banner.className = 'rounded-xl p-2.5 text-xs border bg-emerald-50 border-emerald-200 text-emerald-900 flex items-center gap-2';
    banner.innerHTML = `
      <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0"></i>
      <span><strong>מוכן לסריקה:</strong> הברקוד כולל את מפתח ה-API והיומנים שלך ויעביר אותם אוטומטית לנייד.</span>
    `;
  } else {
    banner.className = 'rounded-xl p-2.5 text-xs border bg-amber-50 border-amber-200 text-amber-900 space-y-2';
    banner.innerHTML = `
      <p class="font-semibold flex items-center gap-1.5">
        <i data-lucide="key" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
        <span>הדבק מפתח API כדי שיוגדר אוטומטית בסריקה:</span>
      </p>
      <div class="flex gap-1.5">
        <input type="password" id="inlineQrApiKeyInput" dir="ltr" placeholder="AIzaSy..." class="flex-1 text-xs rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 font-mono text-gray-900 focus:outline-none focus:border-blue-500">
        <button type="button" id="inlineQrSaveKeyBtn" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[11px] shrink-0">שמור ועדכן QR</button>
      </div>
    `;
    const inlineInput = banner.querySelector('#inlineQrApiKeyInput');
    const inlineBtn = banner.querySelector('#inlineQrSaveKeyBtn');
    if (inlineBtn && inlineInput) {
      inlineBtn.addEventListener('click', () => {
        const val = inlineInput.value.trim();
        if (!val) {
          showToast('נא להדביק מפתח API תקין', 'alert-circle');
          return;
        }
        localStorage.setItem('smartcal_api_key', val);
        const settingsKeyInput = document.getElementById('apiKeyInput');
        if (settingsKeyInput) settingsKeyInput.value = val;
        renderDedicatedQrCode();
        showToast('המפתח נשמר והוטמע בברקוד ה-QR!', 'check');
      });
    }
  }

  const magicUrl = generateMagicSetupUrl(false);
  if (typeof window.qrcode === 'function' && magicUrl) {
    try {
      const qr = window.qrcode(0, 'L');
      qr.addData(magicUrl);
      qr.make();
      canvasBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      const svgEl = canvasBox.querySelector('svg');
      if (svgEl) {
        svgEl.style.width = '200px';
        svgEl.style.height = '200px';
      }
    } catch (err) {
      console.error('QR generation error:', err);
      canvasBox.innerHTML = '<p class="text-xs text-red-600 p-4">שגיאה ביצירת QR. השתמש בכפתור העתקת הקישור למטה.</p>';
    }
  }

  if (window.lucide) window.lucide.createIcons();
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
        }
      }
    }
  } catch (e) {}
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
        showToast('המפתח וכל היומנים הוגדרו במכשיר זה בהצלחה!', 'check');
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
        showToast('התוכן שותף! הזן מפתח API בהגדרות כדי לחלץ את האירוע', 'info');
      }
    }
  } catch (err) {
    console.warn('שגיאה בקליטת שיתוף:', err);
  }
}

// ניהול חלון ה-QR, התקנת PWA בנייד בלבד, והדבקת תמונה ישירה (Ctrl+V)
function setupPwaInstallAndGlobalPaste() {
  const openQrHeaderBtn = document.getElementById('openQrHeaderBtn');
  const qrModal = document.getElementById('mobileQrModal');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');
  const copyDedicatedQrLinkBtn = document.getElementById('copyDedicatedQrLinkBtn');
  const installBtn = document.getElementById('installPwaBtn');

  if (openQrHeaderBtn) {
    openQrHeaderBtn.addEventListener('click', openDedicatedQrModal);
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
      const magicUrl = generateMagicSetupUrl(true);
      if (!magicUrl) return;
      navigator.clipboard.writeText(magicUrl).then(() => {
        showToast('הקישור הישיר הועתק! שלח בוואטסאפ ופתח בנייד', 'check');
      }).catch(() => {
        showToast('לא ניתן להעתיק ללוח הגזירים', 'alert-circle');
      });
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
    // אם אין מפתח, נציג חיווי עדין בהתחלה
    setTimeout(() => {
      showToast('ברוך הבא! לחץ על גלגל השיניים להזנת מפתח API', 'info');
    }, 1200);
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
