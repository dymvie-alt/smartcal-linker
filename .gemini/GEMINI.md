# SmartCal Linker - יומן חכם (Workspace Memory & Context)

## 1. מהו הפרויקט
**SmartCal Linker ("יומן חכם")** היא אפליקציית ווב ומובייל (PWA) ההופכת כל קלט מולטימודלי (טקסט חופשי, הודעת וואטסאפ, קישור לדף אירוע באינטרנט, תמונת הזמנה/פלייר, כרטיס טיסה ב-PDF, או הקלטה קולית) לאירוע מובנה ביומן Google, יומן Outlook Web או קובץ `.ics` בלחיצה אחת.

## 2. נתיבים וכתובות קבועות
- **תיקיית הפרויקט המקומית:** `C:\Users\dymvi\.gemini\antigravity\scratch\smartcal-linker\`
- **שרת מקומי:** `http://localhost:3333` (מופעל ע"י `node server.js` או `start.cmd`)
- **מאגר GitHub:** `https://github.com/dymvie-alt/smartcal-linker` (ענף `main`)
- **כתובת HTTPS חיה (GitHub Pages / PWA למובייל):** `https://dymvie-alt.github.io/smartcal-linker/`

## 3. ארכיטקטורה ויכולות מרכזיות (נכון לגרסה `v20261026_12`)
- **מנוע AI:** קריאה ישירה מהדפדפן ל-`gemini-3.8-flash` עם `responseSchema` קשיח המחזיר `{ events: [...] }`.
- **ריבוי אירועים (Multi-Event Batch Mode):**
  - באירוע בודד (כולל אירוע חוזר קבוע עם `RRULE`): תצוגת טופס רגילה ונקייה.
  - ב-2+ אירועים (טיסות הלוך-חזור, לו"ז כנס/טיול, רשימת פגישות): סרגל ניווט `#multiEventBar`, מעבר אוטומטי לאירוע הבא שטרם נשמר לאחר לחיצה על "פתח ושמור ביומן Google", וכפתור הורדת קובץ `.ics` מאוחד לכל האירועים יחד.
- **אירועים חוזרים (`RRULE`):**
  - זיהוי יומי, שבועי (כולל `BYDAY=SU..SA`), דו-שבועי, חודשי ושנתי + תגית סגולה בולטת `#recurringBadge` בראש כרטיס התוצאה.
- **ניתוב יומני יעד (פרוטוקול 2יומן):**
  - סרגל כפתורי יומנים דינמי (נשמר ב-`localStorage.smartcal_accounts`), מציג תגית אימייל מקוצרת על כל כפתור (`dymvie@`, `dannyonnat@`, `yonnat@hashavia`, `dymvie@ +3`) וכתובת מלאה בכותרת הכרטיס.
  - יומני ברירת מחדל:
    1. `דים (אישי)` — `dymvie@gmail.com`
    2. `דני` — `dannyonnat@gmail.com`
    3. `דניאל` — `yehoshafat.daniel@gmail.com`
    4. `החשבייה (עבודה)` — `yonnat@hashavia.co.il`
    5. `משפחה` (קבוצה) — `dymvie@gmail.com` + מוזמנים: `dannyonnat@gmail.com,yehoshafat.daniel@gmail.com,dyinyy@gmail.com`
- **העברה והתקנה בנייד (Mobile PWA & QR):**
  - כפתור **"העבר לנייד (QR)"** בכותרת העליונה פותח חלון QR ייעודי (`#mobileQrModal`) עם קישור `#setup=...` קומפקטי שמגדיר אוטומטית את מפתח ה-API והיומנים בנייד ומגבה אותם גם ל-`CacheStorage` (`smartcal-config-backup-v1`).
  - כפתור **"הוסף למסך הבית"** מוצג אך ורק במכשירים ניידים (`isMobileDevice`).
- **הגנת מחיקה ו-Undo:**
  - כפתור "אירוע חדש" בודק האם כל האירועים נשמרו/יוצאו; אם לא — מציג חלון אזהרה מותאם (`#confirmResetModal`).
  - לאחר ניקוי מופיע Toast עם כפתור **"בטל" (Undo)** למשך 7 שניות המשחזר את כל סדרת האירועים.
- **היסטוריית אירועים:** שמירת 15 האירועים האחרונים ב-`localStorage.smartcal_history` עם אפשרות טעינה חוזרת לטופס.

## 4. כללי עבודה לפיתוח המשך
- יש לשמור על עבודה מבודדת לחלוטין בתוך `C:\Users\dymvi\.gemini\antigravity\scratch\smartcal-linker\`.
- בכל עדכון של `app.js`, `style.css` או `index.html`, יש לקדם את מזהה הגרסה (`?v=YYYYMMDD_XX`) ב-`index.html` וב-`sw.js` (`CACHE_NAME`), לבצע `git commit` ולדחוף ל-`origin main`.
