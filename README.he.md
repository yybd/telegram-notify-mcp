*[English](README.md) · עברית*

# telegram-notify MCP

שרת MCP קטן **לשליחה בלבד**, שמאפשר ל-Claude (ולכל לקוח MCP) לשלוח **אליך התראות בטלגרם**: משימה מתוזמנת הסתיימה, בנייה ארוכה נכשלה, הגיע זמן תזכורת.

- **נמען אחד, קבוע.** הצ'אט נקבע בהגדרות. אף כלי לא מקבל chat id, ולכן המודל לא יכול לשלוח לאף אחד אחר.
- **לא מושך עדכונים.** הוא קורא ל-`sendMessage`, `sendDocument` ו-`getMe`, ולעולם לא ל-`getUpdates`. אותו בוט יכול להמשיך לשרת כלי אחר שמושך ממנו (למשל תוסף ערוץ הטלגרם של Claude Code) בלי `409 Conflict`, ושום דבר לא פג אחרי 24 שעות.
- **שני כלים**, בלי ספריית טלגרם, שתי תלויות בלבד (ה-SDK של MCP ו-zod).

הסיפור שמאחוריו, עם ההשוואה לשמונה שרתי MCP אחרים לטלגרם: **[לתת ל-Claude לשלוח לכם הודעות בטלגרם, ורק לכם](https://www.bdtech.app/he/blog/telegram-notify?utm_source=github)**.

## כלים

| כלי | מה עושה |
|---|---|
| `notify` | שולח `text` לצ'אט שלך. טקסט פשוט כברירת מחדל; `format: "markdown"` הופך `**מודגש**`, `_נטוי_`, `` `קוד` ``, בלוקי קוד, `[קישורים](https://…)` ו-`# כותרות` ל-HTML של טלגרם, וכל השאר מוברח (escaped). מעל 4096 תווים ההודעה מתפצלת לכמה הודעות. `silent: true` שולח בלי צליל |
| `notify_file` | שולח קובץ (עד 50MB) עם כיתוב אופציונלי, **רק מתיקייה אחת שאישרת** (`TELEGRAM_NOTIFY_FILES_DIR`). הנתיב מתורגם קודם למיקומו האמיתי, כך ש-`..` וקישורים סימבוליים לא יוצאים ממנה. בלי המשתנה הזה כל קריאה נדחית |

הכלים חד-כיווניים: מה שתענה בטלגרם לא חוזר אל המודל.

## התקנה

**1. בוט.** בטלגרם, פתח את [@BotFather](https://t.me/BotFather), שלח `/newbot` והעתק את הטוקן. אפשר גם בוט קיים, אפילו כזה שכלי אחר כבר מושך ממנו.

**2. ה-chat id שלך.** פתח צ'אט עם הבוט ולחץ **Start** (בוט יכול לכתוב רק למי שהתחיל איתו שיחה). אחר כך קבל את המזהה המספרי שלך מבוט כמו [@userinfobot](https://t.me/userinfobot). מזהה של קבוצה הוא שלילי; ערוץ אפשר לתת כ-`@channelname` אחרי שהבוט מנהל בו.

**3. שמירה**, באחת משתי דרכים:

```bash
npx -y @yybd/telegram-notify-mcp setup
```

הפקודה מבקשת את הטוקן (מוסתר) ואת ה-chat id, בודקת את הטוקן, כותבת `~/.telegram-notify/config.json` בהרשאות `600` ושולחת הודעת בדיקה. הוסף `--files-dir <תיקייה>` כדי לאפשר את `notify_file`. `TELEGRAM_NOTIFY_HOME` מזיז את התיקייה.

או משתני סביבה לשרת, שגוברים על הקובץ:

| משתנה | |
|---|---|
| `TELEGRAM_BOT_TOKEN` | חובה |
| `TELEGRAM_CHAT_ID` | חובה; הנמען היחיד |
| `TELEGRAM_NOTIFY_FILES_DIR` | רשות; התיקייה היחידה ש-`notify_file` רשאי לקרוא ממנה. בלעדיו — אין שליחת קבצים |

בדיקה בכל רגע:

```bash
npx -y @yybd/telegram-notify-mcp test
```

## חיבור ללקוחות

### Claude Code

**מומלץ:** קודם `setup` (ראה למעלה), ואחר כך הוספת השרת בלי סודות בשורת הפקודה:

```bash
claude mcp add telegram-notify -s user -- npx -y @yybd/telegram-notify-mcp
```

כך הטוקן נשאר ב-`~/.telegram-notify/config.json` (הרשאות `600`) ולא נכנס ל-`~/.claude.json`.

**או עם משתני סביבה** במקום `setup`. החלף את ערכי הדוגמה בשלך והשאר את המרכאות. אל תקליד סוגריים משולשים כמו `<token>`: המעטפת קוראת את `<` כ"קרא מקובץ", והפקודה נכשלת עם `no such file or directory`.

```bash
claude mcp add telegram-notify -s user -e TELEGRAM_BOT_TOKEN="123456789:AAExampleTokenFromBotFather" -e TELEGRAM_CHAT_ID="987654321" -- npx -y @yybd/telegram-notify-mcp
```

בדרך הזו הטוקן נשמר ב-`~/.claude.json`.

השרת מופיע בסשנים חדשים; סשן שכבר פתוח לא רואה אותו.

כדי לשלוח בלי בקשת אישור בכל פעם, אשר את הכלי ב-`~/.claude/settings.json`: `"permissions": { "allow": ["mcp__telegram-notify__notify"] }`. זה בטוח בזכות הנמען הקבוע: הגרוע ביותר שמודל מבולבל יכול לעשות הוא לשלוח הודעה אליך.

### Claude Desktop

**בלחיצה אחת (מומלץ):** הורד את `telegram-notify-<version>.mcpb` מה-[Release האחרון](https://github.com/yybd/telegram-notify-mcp/releases/latest) ולחץ עליו פעמיים, או גרור אותו אל **Settings ← Extensions** ב-Claude Desktop. ‏Desktop מבקש את טוקן הבוט (נשמר כסוד), את ה-chat id ובאופן אופציונלי את תיקיית הקבצים, ומתקין. לא צריך שום דבר נוסף: Desktop מריץ את התוסף עם Node.js משלו, ולא צריך `setup`.

**או ידנית:** ב-`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) או `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "telegram-notify": {
      "command": "npx",
      "args": ["-y", "@yybd/telegram-notify-mcp"]
    }
  }
}
```

אם לא הרצת `setup`, הוסף `"env": { "TELEGRAM_BOT_TOKEN": "…", "TELEGRAM_CHAT_ID": "…" }`. אחר כך הפעל מחדש את Claude Desktop. אם הוא לא מוצא את `npx`, תן נתיב מלא (`which npx`).

## השוואה

נבדק ב-7.11.2026 מול קוד המקור של כל פרויקט; מספרי הכוכבים מאותו יום.

| אפשרות | נמען | מושך עדכונים (`getUpdates`) | חולק בוט עם מושך אחר | כלים | קבצים |
|---|---|---|---|---|---|
| **telegram-notify (זה)** | קבוע בהגדרות; אין פרמטר בכלי | **אף פעם** | כן | 2 | תיקייה מאושרת אחת, מוגן מקישורים סימבוליים; כבוי כברירת מחדל |
| [ParthJadhav/telegram-notify-mcp](https://github.com/ParthJadhav/telegram-notify-mcp) (7 ⭐) | נמצא לפי שם משתמש ב-`getUpdates` | כן, בכל הפעלה של התהליך | לא | 3 | כל נתיב מקומי |
| [aahl/mcp-notify](https://github.com/aahl/mcp-notify) (29 ⭐) | `TELEGRAM_DEFAULT_CHAT`, אבל כל כלי טלגרם מקבל `chat_id` שהמודל יכול לעקוף | לא | כן | 20+ (טלגרם, WeCom, Home Assistant ועוד) | לפי URL |
| [antonio-castellon/mcp-telegram-bridge](https://github.com/antonio-castellon/mcp-telegram-bridge) (0 ⭐) | `chat_id` בכל קריאה | כן, כלי `telegram_get_updates` | לא | 6 | לא |
| תוספי הערוצים הרשמיים של Claude (טלגרם) | מי שמתאמת | כן, ברציפות | הוא עצמו המושך | — | כן |

**למה זה חשוב:**
- **ParthJadhav/telegram-notify-mcp** הכי קרוב בצורה, אבל לומד את ה-chat id שלך מ-`getUpdates` בכל הפעלה. טלגרם שומר עדכונים 24 שעות בלבד, ולכן יום אחרי שכתבת לבוט בפעם האחרונה הוא כבר לא מוצא אותך. קריאת ה-`getUpdates` שלו גם נכשלת ב-`409 Conflict` כשתהליך אחר מושך מאותו בוט.
- **aahl/mcp-notify** עובד עם צ'אט ברירת מחדל, אבל המודל רשאי להעביר כל `chat_id`, והוא רושם כעשרים כלים על פני פלטפורמות רבות.
- **mcp-telegram-bridge** דו-כיווני מעצם תכנונו: הוא קורא הודעות נכנסות, ולכן אינו יכול להיות לשליחה בלבד ויש לו אותה התנגשות משיכה.
- **תוספי הערוצים** מושכים מהבוט כדי לקבל הודעות, ושייכים לסשן האחד שמריץ אותם; הם לא דרך לכל סשן ולכל לקוח להודיע לך.

**מה telegram-notify נותן:** נמען קבוע, בלי משיכה, בוט אחד משותף עם שאר הכלים שלך, שני כלים, ושליחת קבצים שמוגבלת לתיקייה אחת. מה הוא בכוונה לא עושה: לקבל הודעות, לשאול אותך שאלות ולחכות לתשובה, או לשלוח למישהו אחר.

## אבטחה

- הטוקן לא נרשם ללוג, ומוסר מכל הודעת שגיאה לפני שהיא מגיעה למודל או לטרמינל.
- `config.json` נכתב בהרשאות `600`.
- השרת לא כותב ל-stdout דבר מלבד פרוטוקול MCP, ומדבר רק עם `api.telegram.org`.

## פיתוח

```bash
npm test
```

הבדיקות רצות בלי רשת, עם `fetch` מדומה. הן בודקות ש-`getUpdates` לא נקרא אף פעם, ש-`chat_id` שהוברח מתעלמים ממנו, שארגז החול של הקבצים דוחה `..`, נתיבים מוחלטים וקישורים סימבוליים, שהטוקן מוסר משגיאות, ושטקסט ארוך מתפצל.

`./scripts/pack-mcpb.sh` בונה את תוסף Claude Desktop, `telegram-notify-<version>.mcpb`, מתוך `manifest.json`, `dist/` והתלויות של זמן ריצה.

## רישיון

MIT
