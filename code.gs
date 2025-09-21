const MASTER_SHEET_ID = "1acpcfx9dDtP28GJFdtV_kVeiNpw0mUJNxL-2iOyfOKc";
const MASTER_USERS_SHEET = "Users"; // Tab name in master sheet

function hashPassword(password) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password));
}

function getScriptOwnerEmail() {
  return Session.getEffectiveUser().getEmail();
}

// ===== Master Sheet User Management =====
function getMasterUsers() {
  var sheet = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_USERS_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    users.push({
      email: (data[i][0] || '').toLowerCase().trim(),
      password: data[i][1],
      dept: data[i][2] || '',
      semester: data[i][3] || '',
      sheetId: data[i][4] || ''
    });
  }
  return users;
}
function saveMasterUser(user) {
  var sheet = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_USERS_SHEET);
  if (!sheet) {
    sheet = SpreadsheetApp.openById(MASTER_SHEET_ID).insertSheet(MASTER_USERS_SHEET);
    sheet.appendRow(["Email", "Password", "Department", "Semester", "SheetID"]);
  }
  var data = sheet.getDataRange().getValues();
  var found = -1;
  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase().trim() === user.email.toLowerCase().trim()) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    sheet.getRange(found, 1, 1, 5).setValues([[user.email, user.password, user.dept, user.semester, user.sheetId]]);
  } else {
    sheet.appendRow([user.email, user.password, user.dept, user.semester, user.sheetId]);
  }
}
function getMasterUser(email) {
  var users = getMasterUsers();
  return users.find(u => u.email === email.toLowerCase().trim());
}

// ===== Signup =====
function signup(email, dept, semester, sheetId, password) {
  email = email.trim().toLowerCase();
  var users = getMasterUsers();
  if (users.some(u => u.email === email)) return {success:false, message:"Email already registered"};
  // Check Sheet access before saving
  var canAccess = false, errorMsg = "";
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    canAccess = true;
    // Try creating Attendance sheet/tab if missing
    var sheet = ss.getSheetByName("Attendance");
    if (!sheet) {
      sheet = ss.insertSheet("Attendance");
      sheet.appendRow(["Date","Department","Semester","Enroll","Name","Status"]);
    }
  } catch(e) {
    errorMsg = "Cannot access the Google Sheet. Please open your sheet and click 'Share', then add this email: " + getScriptOwnerEmail() + " with Editor access. After sharing, try signing up again.";
  }
  if (!canAccess) return {success:false, message:errorMsg};
  var userData = {
    email: email,
    password: hashPassword(password),
    dept: dept,
    semester: semester,
    sheetId: sheetId
  };
  saveMasterUser(userData);
  var scriptProps = PropertiesService.getScriptProperties();
  var userDb = getAllUserDb();
  userDb[email] = { students: [], resetToken: "" };
  saveAllUserDb(userDb);
  return {success: true};
}

// ===== Login =====
function login(email, password) {
  email = email.trim().toLowerCase();
  var user = getMasterUser(email);
  if (user && user.password === hashPassword(password)) {
    return {
      email: user.email,
      dept: user.dept,
      semester: user.semester,
      sheetId: user.sheetId,
      success: true
    };
  }
  return {success: false};
}

// ===== Forgot Password =====
function sendResetToken(email) {
  var userDb = getAllUserDb();
  email = email.trim().toLowerCase();
  if (!getMasterUser(email)) return {success: false, message: "Email not found"};
  var token = Math.random().toString(36).substr(2, 6).toUpperCase();
  if (!userDb[email]) userDb[email] = { students: [], resetToken: "" };
  userDb[email].resetToken = token;
  saveAllUserDb(userDb);
  MailApp.sendEmail(email, "Attendance Portal Password Reset", "Your reset token is: " + token);
  return {success: true};
}
function resetPassword(email, token, newPassword) {
  email = email.trim().toLowerCase();
  var userDb = getAllUserDb();
  var user = getMasterUser(email);
  if (!user) return {success: false, message: "Email not found"};
  if (userDb[email] && userDb[email].resetToken === token) {
    user.password = hashPassword(newPassword);
    saveMasterUser(user);
    userDb[email].resetToken = "";
    saveAllUserDb(userDb);
    return {success: true};
  }
  return {success: false, message: "Invalid token"};
}

// ===== Per-user Students Management (in script properties) =====
function getAllUserDb() {
  var scriptProps = PropertiesService.getScriptProperties();
  var data = scriptProps.getProperty("USER_DB");
  return data ? JSON.parse(data) : {};
}
function saveAllUserDb(obj) {
  PropertiesService.getScriptProperties().setProperty("USER_DB", JSON.stringify(obj));
}
function getStudents(email) {
  email = email.trim().toLowerCase();
  var userDb = getAllUserDb();
  return userDb[email] ? userDb[email].students || [] : [];
}
function saveStudents(email, students) {
  email = email.trim().toLowerCase();
  var userDb = getAllUserDb();
  if (!userDb[email]) userDb[email] = { students: [], resetToken: "" };
  userDb[email].students = students;
  saveAllUserDb(userDb);
  return {success: true};
}

// ===== Attendance Storage & Retrieval =====
function saveAttendance(email, attendanceData) {
  email = email.trim().toLowerCase();
  var user = getMasterUser(email);
  if (!user) return {success: false, message: "User not found"};
  if (!user.sheetId) return {success: false, message: "No attendance sheet"};
  var ss;
  try {
    ss = SpreadsheetApp.openById(user.sheetId);
  } catch(e) {
    return {success: false, message: "Cannot access attendance sheet. Please open your sheet and click 'Share', then add this email: " + getScriptOwnerEmail() + " with Editor access."};
  }
  var sheet = ss.getSheetByName("Attendance");
  if (!sheet) {
    sheet = ss.insertSheet("Attendance");
    sheet.appendRow(["Date","Department","Semester","Enroll","Name","Status"]);
  }
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) sheet.appendRow(["Date","Department","Semester","Enroll","Name","Status"]);
  var rows = attendanceData.students.map(s => [
    attendanceData.date, user.dept, user.semester, s.enroll, s.name, s.status
  ]);
  sheet.getRange(sheet.getLastRow()+1, 1, rows.length, 6).setValues(rows);
  return {success: true};
}
function getAttendance(email, filter) {
  email = email.trim().toLowerCase();
  var user = getMasterUser(email);
  if (!user) return [];
  var ss;
  try { ss = SpreadsheetApp.openById(user.sheetId); } catch(e){ return []; }
  var sheet = ss.getSheetByName("Attendance");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var headers = ["Date","Department","Semester","Enroll","Name","Status"];
  var result = [];
  for (var i=1; i<data.length; i++) {
    var row = {};
    for (var j=0;j<headers.length;j++) row[headers[j]] = data[i][j];
    if (!filter || filter.status==="All" || row.Status===filter.status) {
      if (!filter.search || row.Enroll.includes(filter.search)) result.push(row);
    }
  }
  return result;
}

// ===== Web App Entrypoint =====
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
