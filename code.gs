const MASTER_SHEET_ID = "1acpcfx9dDtP28GJFdtV_kVeiNpw0mUJNxL-2iOyfOKc";
const MASTER_USERS_SHEET = "Users";
const ACCOUNT_DB_PROP = "ATTENDANCE_ACCOUNT_DB";

/* Serve frontend */
function doGet(){ 
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Attendance Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); 
}

function include(filename){ 
  return HtmlService.createHtmlOutputFromFile(filename).getContent(); 
}

/* Master sheet helpers */
function getMasterSheet(){
  try{
    const ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    let sheet = ss.getSheetByName(MASTER_USERS_SHEET);
    if(!sheet){
      sheet = ss.insertSheet(MASTER_USERS_SHEET);
      sheet.appendRow(["AccountId","Email","Password","Department","Semester","Subject","SheetID","CreatedAt"]);
    }
    return sheet;
  } catch(e){ 
    throw new Error("Cannot access master sheet. Check MASTER_SHEET_ID and sharing."); 
  }
}

function getMasterUsers(){
  try{
    const sheet = getMasterSheet();
    const data = sheet.getDataRange().getValues();
    const users = [];
    for(let i=1;i<data.length;i++){
      users.push({
        accountId: (data[i][0]||'').toString(),
        email: (data[i][1]||'').toString().toLowerCase().trim(),
        password: (data[i][2]||'').toString(),
        dept: (data[i][3]||'').toString(),
        semester: (data[i][4]||'').toString(),
        subject: (data[i][5]||'').toString(),
        sheetId: (data[i][6]||'').toString(),
        createdAt: (data[i][7]||'').toString()
      });
    }
    return users;
  } catch(e){ 
    return []; 
  }
}

function saveMasterUserRow(user){
  if(!user || !user.accountId) return false;
  const sheet = getMasterSheet();
  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  for(let i=1;i<data.length;i++){
    if((data[i][0]||'').toString() === user.accountId){ 
      foundRow = i+1; 
      break; 
    }
  }
  const row = [
    user.accountId||'', 
    user.email||'', 
    user.password||'', 
    user.dept||'', 
    user.semester||'', 
    user.subject||'', 
    user.sheetId||'', 
    user.createdAt || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
  ];
  if(foundRow>0) 
    sheet.getRange(foundRow,1,1,row.length).setValues([row]); 
  else 
    sheet.appendRow(row);
  return true;
}

/* Per-account DB */
function getAllAccountDb(){ 
  try{ 
    const prop = PropertiesService.getScriptProperties().getProperty(ACCOUNT_DB_PROP); 
    return prop ? JSON.parse(prop) : {}; 
  } catch(e){ 
    return {}; 
  } 
}

function saveAllAccountDb(obj){ 
  PropertiesService.getScriptProperties().setProperty(ACCOUNT_DB_PROP, JSON.stringify(obj)); 
}

/* Signup / Login / Profile */
function signup(email, dept, semester, subject, sheetId, password){
  if(!email || !sheetId || !password) 
    return { success:false, message:'Email, Sheet ID and password required.' };
  
  email = email.toString().toLowerCase().trim();
  
  try{ 
    const ss = SpreadsheetApp.openById(sheetId); 
    let att = ss.getSheetByName('Attendance'); 
    if(!att){ 
      att = ss.insertSheet('Attendance'); 
      att.appendRow(["Date","Department","Semester","Subject","Enroll","Status"]); 
    } 
  } catch(e){ 
    return { success:false, message:'Cannot access provided Google Sheet. Share it with the script owner and try again.' }; 
  }
  
  const accountId = Utilities.getUuid(); 
  const createdAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const user = { accountId, email, password, dept:dept||'', semester:semester||'', subject:subject||'', sheetId, createdAt };
  const ok = saveMasterUserRow(user); 
  
  if(!ok) return { success:false, message:'Failed to save user.' };
  
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true }; 
  saveAllAccountDb(db);
  
  return { success:true, accountId };
}

function login(email, password){
  if(!email || !password) return { success:false, message:'Missing credentials' };
  email = email.toString().toLowerCase().trim();
  const users = getMasterUsers();
  const matched = users.filter(u=>u.email===email && u.password===password)
    .map(u=>({ 
      accountId:u.accountId, 
      dept:u.dept, 
      semester:u.semester, 
      subject:u.subject, 
      sheetId:u.sheetId, 
      createdAt:u.createdAt 
    }));
  
  if(matched.length===0) return { success:false, message:'Invalid email or password' };
  return { success:true, accounts: matched };
}

function updateProfile(accountId, dept, semester, subject){
  if(!accountId) return { success:false, message:'Account ID required' };
  const acc = getMasterUsers().find(u=>u.accountId===accountId);
  if(!acc) return { success:false, message:'Account not found' };
  
  acc.dept = dept||acc.dept; 
  acc.semester = semester||acc.semester; 
  acc.subject = subject||acc.subject;
  const ok = saveMasterUserRow(acc);
  
  return ok ? { success:true } : { success:false, message:'Failed to update' };
}

/* Forgot / Reset */
function getAccountsByEmail(email){
  if(!email) return [];
  email = email.toString().toLowerCase().trim();
  const users = getMasterUsers();
  return users.filter(u=>u.email===email)
    .map(u=>({ 
      accountId:u.accountId, 
      dept:u.dept, 
      semester:u.semester, 
      subject:u.subject, 
      sheetId:u.sheetId 
    }));
}

function sendResetToken(accountId){
  if(!accountId) return { success:false, message:'Account ID required' };
  const acc = getAccountById(accountId); 
  if(!acc) return { success:false, message:'Account not found' };
  
  const token = Math.random().toString(36).substr(2,6).toUpperCase();
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true }; 
  db[accountId].resetToken = token; 
  saveAllAccountDb(db);
  
  try{ 
    MailApp.sendEmail(acc.email, "Attendance Portal - Reset token", "Your reset token: " + token); 
    return { success:true }; 
  } catch(e){ 
    return { success:true, token }; 
  }
}

function resetPassword(accountId, token, newPassword){
  if(!accountId || !token || !newPassword) 
    return { success:false, message:'All fields required' };
  
  const db = getAllAccountDb(); 
  if(!db[accountId] || db[accountId].resetToken !== token) 
    return { success:false, message:'Invalid token' };
  
  const acc = getAccountById(accountId); 
  if(!acc) return { success:false, message:'Account not found' };
  
  acc.password = newPassword; 
  const ok = saveMasterUserRow(acc); 
  if(!ok) return { success:false, message:'Failed to update password' };
  
  db[accountId].resetToken = ''; 
  saveAllAccountDb(db); 
  return { success:true };
}

/* Students */
function getStudentsByAccount(accountId){ 
  const db = getAllAccountDb(); 
  return db[accountId] ? (db[accountId].students || []) : []; 
}

function saveStudentsByAccount(accountId, students){ 
  if(!accountId) return { success:false, message:'Account ID required' }; 
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true }; 
  db[accountId].students = students || []; 
  db[accountId].firstLoginSetup = false; 
  saveAllAccountDb(db); 
  return { success:true }; 
}

/* Attendance */
function canSaveAttendance(accountId, date){
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true };
  const checkDate = date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return (db[accountId].attendanceHistory || []).indexOf(checkDate) === -1;
}

function saveAttendanceByAccount(accountId, attendanceData){
  if(!accountId || !attendanceData) return { success:false, message:'Missing data' };
  const acc = getAccountById(accountId);
  if(!acc) return { success:false, message:'Account not found' };
  if(!acc.sheetId) return { success:false, message:'No sheet ID configured for this account' };
  
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true };
  const dateStr = attendanceData.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  
  if((db[accountId].attendanceHistory || []).indexOf(dateStr) !== -1) 
    return { success:false, message:'Attendance already saved for this date.' };
  
  let ss;
  try{ 
    ss = SpreadsheetApp.openById(acc.sheetId); 
  } catch(e){ 
    return { success:false, message:'Cannot access attendance sheet. Ensure it is shared properly.' }; 
  }
  
  let sheet = ss.getSheetByName('Attendance');
  if(!sheet){ 
    sheet = ss.insertSheet('Attendance'); 
    sheet.appendRow(["Date","Department","Semester","Subject","Enroll","Status"]); 
  }
  
  const rows = (attendanceData.students || []).map(s=>[
    dateStr, 
    acc.dept||'', 
    acc.semester||'', 
    acc.subject||'', 
    s.enroll||'', 
    s.status||'Absent'
  ]);
  
  if(rows.length===0) return { success:false, message:'No attendance rows' };
  
  sheet.getRange(sheet.getLastRow()+1,1,rows.length,6).setValues(rows);
  db[accountId].attendanceHistory = db[accountId].attendanceHistory || [];
  db[accountId].attendanceHistory.push(dateStr);
  saveAllAccountDb(db);
  
  return { success:true };
}

/* Get attendance */
function getAttendanceByAccount(accountId, filter){
  const acc = getAccountById(accountId);
  if(!acc || !acc.sheetId) return [];
  
  try{
    const ss = SpreadsheetApp.openById(acc.sheetId);
    const sheet = ss.getSheetByName('Attendance');
    if(!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = ["Date","Department","Semester","Subject","Enroll","Status"];
    const out = [];
    
    for(let i=1;i<data.length;i++){
      const row = {};
      for(let j=0;j<headers.length;j++) row[headers[j]] = data[i][j];
      
      let ok = true;
      if(filter){
        if(filter.status && filter.status !== 'All' && row.Status !== filter.status) ok = false;
        if(filter.search && filter.search.length && (row.Enroll||'').toString().indexOf(filter.search) === -1) ok = false;
      }
      if(ok) out.push(row);
    }
    return out;
  } catch(e){ 
    return []; 
  }
}

/* Total classes */
function getTotalClasses(accountId){
  try{
    if(!accountId) return 0;
    const db = getAllAccountDb();
    if(!db[accountId] || !db[accountId].attendanceHistory) return 0;
    return (db[accountId].attendanceHistory || []).length;
  } catch(e){ 
    return 0; 
  }
}

/* Student Status Checker - Public (No Login Required) */
function getStudentStatus(department, semester, enrollment){
  if(!department || !semester || !enrollment) 
    return { success: false, message: 'All fields required' };
  
  try {
    const users = getMasterUsers();
    const matchingTeachers = users.filter(u => 
      u.dept === department && u.semester === semester && u.sheetId
    );
    
    if(matchingTeachers.length === 0) {
      return { success: false, message: 'No teachers found for this department and semester' };
    }
    
    const subjectStats = {};
    
    for(const teacher of matchingTeachers) {
      try {
        const ss = SpreadsheetApp.openById(teacher.sheetId);
        const sheet = ss.getSheetByName('Attendance');
        
        if(!sheet) continue;
        
        const data = sheet.getDataRange().getValues();
        
        for(let i = 1; i < data.length; i++) {
          const row = data[i];
          const rowDept = (row[1] || '').toString();
          const rowSem = (row[2] || '').toString();
          const rowSubject = (row[3] || '').toString();
          const rowEnroll = (row[4] || '').toString();
          const rowStatus = (row[5] || '').toString();
          
          if(rowDept === department && rowSem === semester && rowEnroll === enrollment) {
            if(!subjectStats[rowSubject]) {
              subjectStats[rowSubject] = {
                total: 0,
                present: 0,
                absent: 0
              };
            }
            
            subjectStats[rowSubject].total++;
            
            if(rowStatus === 'Present') {
              subjectStats[rowSubject].present++;
            } else {
              subjectStats[rowSubject].absent++;
            }
          }
        }
      } catch(e) {
        continue;
      }
    }
    
    if(Object.keys(subjectStats).length === 0) {
      return { success: false, message: 'No attendance records found for this enrollment number' };
    }
    
    return { success: true, data: subjectStats };
    
  } catch(e) {
    return { success: false, message: 'Error fetching attendance data: ' + e.message };
  }
}

/* Helpers */
function getAccountById(accountId){ 
  if(!accountId) return null; 
  const users = getMasterUsers(); 
  return users.find(u=>u.accountId===accountId) || null; 
}

function isFirstLogin(accountId){ 
  const db = getAllAccountDb(); 
  db[accountId] = db[accountId] || { students: [], attendanceHistory: [], resetToken:'', firstLoginSetup:true }; 
  return !!db[accountId].firstLoginSetup; 
}
