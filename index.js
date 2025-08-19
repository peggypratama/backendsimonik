const express = require('express');
const cors = require("cors");
const axios = require('axios');
const { json } = require('body-parser');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv'); // Import dotenv
const { file } = require('googleapis/build/src/apis/file');
dotenv.config(); // Panggil .config() di awal file


//========================================

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
const port = process.env.PORT || 3000;
const appsScriptWebAppUrl = "https://script.google.com/macros/s/AKfycbwxVsRY1Dgo_jQ24bhvqChVZaqQ5yrU2TmG1OQNX1i7R0cIBa9n7dUYcLZipZKNl5cu/exec";

//==========================================

// Load credentials from the downloaded JSON file
// const credentials = require('./credential.json');
// const { client_secret, client_id, redirect_uris } = credentials.web;

// Ambil kredensial dari environment variables
const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uri = process.env.GOOGLE_REDIRECT_URI;
// const redirect_uri2 = process.env.GOOGLE_REDIRECT_URI2;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uri,
  // redirect_uri2
);

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const tempDir = path.join('/tmp', 'uploads');

// Pastikan direktori /tmp/uploads sudah ada
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Dengan `recursive: true`, direktori 'uploads' akan dibuat secara otomatis
    // di dalam '/tmp' jika belum ada.
    fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});


const upload = multer({ storage: storage });

// const upload = multer({ dest: 'uploads/' });

///======================================

const corsOptions = {
  origin: '*',
  credentials: true,            //access-control-allow-credentials:true
  optionSuccessStatus: 200,
}

app.use(cors(corsOptions)) // Use this after the variable declaration


//============================================================================================
//============================================================================================
//                                             API                                           
//============================================================================================
//============================================================================================

app.post('/login', async (req, res) => {

  try {
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      // state: req.query.param
    });

    const response = await axios.get(appsScriptWebAppUrl, {
      // Data yang dikirim sebagai query string (?nama=Alice)
      params: {
        operation: "CHECKUSER",
        username: req.body['username'],
        password: req.body['password']
      },
    });
    response.data.authorizeUrl = authorizeUrl;
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.get('/auth', (req, res) => {
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    // state: req.query.param
  });
  res.redirect(authorizeUrl);

});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  // res.send('Autentikasi berhasil! Anda sekarang dapat mengunggah file.');
  res.redirect("https://simonik.appwrite.network")
});

//==================================================================================
/**
 * Mencari atau membuat folder di Google Drive.
 * @param {string} folderName Nama folder yang ingin dibuat atau dicari.
 * @param {string} parentId ID folder induk (opsional).
 * @returns {Promise<object>} Objek yang berisi ID dan nama folder.
 */


async function findOrCreateFolder(folderName, parentId = null) {
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });

  // 1. Buat query pencarian
  let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  // 2. Lakukan pencarian folder
  const searchResponse = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
  });

  // Jika folder ditemukan, kembalikan ID-nya
  if (searchResponse.data.files.length > 0) {
    const existingFolder = searchResponse.data.files[0];
    // console.log(`Folder '${existingFolder.name}' sudah ada. Menggunakan ID: ${existingFolder.id}`);
    return existingFolder;
  }

  // Jika folder tidak ditemukan, buat folder baru
  try {
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      fileMetadata.parents = [parentId];
    }
    const createResponse = await drive.files.create({
      resource: fileMetadata,
      fields: 'id, name',
    });
    // console.log(`Folder '${createResponse.data.name}' berhasil dibuat dengan ID: ${createResponse.data.id}`);
    return createResponse.data;
  } catch (error) {
    console.error('Terjadi error saat membuat folder:', error);
    throw error;
  }
}

/**
 * Menghapus file dari Google Drive berdasarkan ID.
 * @param {string} fileId ID file yang ingin dihapus.
 */
async function deleteFileFromDrive(fileId) {
  if (!oAuth2Client.credentials.access_token) {
    throw new Error("11");
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    await drive.files.delete({
      fileId: fileId,
    });

    // console.log(`File dengan ID: ${fileId} berhasil dihapus.`);
    return true;
  } catch (error) {
    console.error('Terjadi error saat menghapus file:', error);
    throw error; // Lempar error untuk ditangani di endpoint
  }
}

async function uploadFileToDrive(file, fileName, folderId) {
  if (!oAuth2Client.credentials.access_token) {
    throw new Error("11");
  }

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });

  // Siapkan metadata file untuk diunggah ke folder
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType: file.mimetype,
    body: fs.createReadStream(file.path),
  };

  // --- Ubah di sini: Tambahkan 'webViewLink' di fields ---
  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink', // Meminta webViewLink
  });
  const fileId = response.data.id;
  // const fileLink = response.data.webViewLink;
  // response.data.fileName = fileName;

  // --- Tambahkan kode ini untuk membuat file bisa diakses publik ---
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return response.data;
}

/**
 * Menghapus banyak file dari Google Drive berdasarkan array ID.
 * @param {string[]} fileIds Array ID file yang ingin dihapus.
 */

async function deleteMultipleFilesFromDrive(fileIds) {
  if (!oAuth2Client.credentials.access_token) {
    throw new Error("11");
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    const deletePromises = fileIds.map(fileId =>
      drive.files.delete({ fileId: fileId })
    );

    // await Promise.all(deletePromises);
    // console.log(`${fileIds.length} file berhasil dihapus.`);
    return true; // <<< Mengembalikan true jika sukses
  } catch (error) {
    // console.error('Terjadi error saat menghapus file:', error.message);
    return false; // <<< Mengembalikan false jika ada kesalahan
  }
}

// Multiple File
async function uploadFilesToDrive(files, folderId, namaFile) {
  if (!oAuth2Client.credentials.access_token) {
    throw new Error("11");
  }

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  const uploadPromises = files.map((file, index) => {

    const newFileName = `${namaFile}-${index + 1}${path.extname(file.originalname)}`;

    const fileMetadata = {
      name: newFileName,
      parents: [folderId], // Tambahkan jika ingin di folder tertentu
    };
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };
    return drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink',
    });
  });

  // Menunggu semua proses upload selesai secara bersamaan
  const responses = await Promise.all(uploadPromises);
  return responses.map(res => res.data);
}

//========================================
//                 TESING
//========================================
app.post('/upload-multiple', upload.array('files'), async (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).send('Tidak ada file yang diunggah.');
  }


  try {

    // 1. folder utama
    const mainFolder = await findOrCreateFolder('FOTO');
    const mainFolderId = mainFolder.id;


    const driveResponse = await uploadFilesToDrive(req.files, mainFolderId);

    req.files.forEach(file => fs.unlinkSync(file.path));

    const uploadedFilesData = driveResponse.map(res => ({
      id: res.id,
      name: res.name, // <<-- Nama file dikembalikan dari respons Google Drive
      link: res.webViewLink
    }));

    res.status(200).json({
      message: `${driveResponse.length} file berhasil diunggah!`,
      uploadedFiles: uploadedFilesData, // Kirim array ini sebagai respons
    })

  } catch (error) {
    console.error('Error:', error);
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

// --- Endpoint API baru untuk menghapus banyak file ---
app.post('/delete-multiple', async (req, res) => {
  const { fileIds } = req.body;
  try {
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'Array ID file tidak valid.' });
    }

    // --- Gunakan nilai kembalian dari fungsi ---
    const isSuccess = await deleteMultipleFilesFromDrive(fileIds);

    if (isSuccess) {
      res.status(200).json({ message: `${fileIds.length} file berhasil dihapus.` });
    } else {
      // Tangani kasus gagal di sini
      res.status(500).json({ error: 'Gagal menghapus file.' });
    }
  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});
//========================================
//                 LOKASI
//========================================

app.get('/get_lokasi', async (req, res) => {
  try {
    const response = await axios.get(appsScriptWebAppUrl, {
      // Data yang dikirim sebagai query string (?nama=Alice)
      params: {
        operation: "GETLOKASI",
      },
    });
    res.send(response.data);
  } catch {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/set_lokasi', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "SETLOKASI",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/del_lokasi', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "DELLOKASI",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/edit_lokasi', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "EDITLOKASI",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

//========================================
//            USER
//========================================

app.get('/get_user', async (req, res) => {
  try {
    const response = await axios.get(appsScriptWebAppUrl, {
      // Data yang dikirim sebagai query string (?nama=Alice)
      params: {
        operation: "GETUSER",
      },
    });
    res.send(response.data);
  } catch {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/set_user', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "SETUSER",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/del_user', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "DELUSER",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

//========================================
//            BERITA ACARA
//========================================

// app.get('/get_berita_acara', async (req, res) => {
//   try {
//     const response = await axios.get(appsScriptWebAppUrl, {
//       // Data yang dikirim sebagai query string (?nama=Alice)
//       params: {
//         operation: "GETBERITAACARA",
//       },
//     });
//     res.send(response.data);
//   } catch {
//     res.json({
//       "responseCode": "99",
//       "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
//     });
//   }
// });

app.post('/get_berita_acara', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "GETBERITAACARA",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });

  }
});

app.post('/set_berita_acara', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.json({
      "responseCode": "99",
      "responseMessage": "Tidak Ada File yang di upload" // Gunakan error.message untuk pesan yang lebih baik
    });
  }

  try {
    const metadataString = req.body.metadata;

    // 1. folder utama
    const mainFolder = await findOrCreateFolder('BERITA ACARA');
    const mainFolderId = mainFolder.id;

    // 2. sub-folder di dalam folder utama
    const subFolder = await findOrCreateFolder(metadataString.lokasi, mainFolderId);
    const subFolderId = subFolder.id;


    // 3. sub-sub-folder di dalam sub folder
    const subSubFolder = await findOrCreateFolder(metadataString.jenisBeritaAcara, subFolderId);
    const subSubFolderId = subSubFolder.id;


    const driveResponse = await uploadFileToDrive(req.file, metadataString.fileName, subSubFolderId);
    fs.unlinkSync(req.file.path);
    const fileName = driveResponse.name;
    
    const fileLink = driveResponse.webViewLink;
    const fileId = driveResponse.id;

    metadataString.namaFile = fileName;
    metadataString.fileLink = fileLink;
    metadataString.fileId = fileId;

    //Upload dlu ke sheet

    //------
    const response = await axios.post(appsScriptWebAppUrl, metadataString, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "SETBERITAACARA",
      },
    });
    res.send(response.data);
  } catch (error) {

    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/edit_berita_acara', async (req, res) => {

  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "EDITBERITAACARA",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

app.post('/del_berita_acara', async (req, res) => {
  try {
    const fileId = req.body['fileId'];
    if (!fileId) {
      res.json({
        "responseCode": "99",
        "responseMessage": "File Id Tidak Ditemukan" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    const del = await deleteFileFromDrive(fileId);
    if (del) {
      const response = await axios.post(appsScriptWebAppUrl, req.body, {
        headers: {
          'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
        },
        params: {
          operation: "DELBERITAACARA",
        },
      });
      return res.send(response.data);
    } else {
      return res.json({
        "responseCode": "99",
        "responseMessage": "Gagal Menghapus File" // Gunakan error.message untuk pesan yang lebih baik
      });
    }
  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});


//========================================
//            FOTO
//========================================

app.get('/get_foto_prop', async (req, res) => {
  try {
    const response = await axios.get(appsScriptWebAppUrl, {
      // Data yang dikirim sebagai query string (?nama=Alice)
      params: {
        operation: "GETFOTOPROP",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});

// app.get('/get_foto', async (req, res) => {
//   try {
//     const response = await axios.get(appsScriptWebAppUrl, {
//       // Data yang dikirim sebagai query string (?nama=Alice)
//       params: {
//         operation: "GETFOTO",
//       },
//     });
//     res.send(response.data);
//   } catch (error){
//     res.json({
//       "responseCode": "99",
//       "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
//     });
//   }
// });

app.post('/get_foto', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "GETFOTO",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });

  }
});

app.post('/set_foto', upload.array('files'), async (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).send('Tidak ada file yang diunggah.');
  }

  try {
    const metadataString = req.body.metadata;

    // 1. folder utama
    const mainFolder = await findOrCreateFolder('FOTO');
    const mainFolderId = mainFolder.id;

    // 2. lokasi
    const lokasiFolder = await findOrCreateFolder(metadataString.lokasi, mainFolderId);
    const lokasiFolderId = lokasiFolder.id;

    // 3. jenis
    const jenisFotoFolder = await findOrCreateFolder(metadataString.jenisFoto, lokasiFolderId);
    const jenisFotoFolderid = jenisFotoFolder.id;

    var folderid = jenisFotoFolderid;

    if (metadataString.subJenisFoto != "") {
      // 4. sub jenis
      const subJenisFolder = await findOrCreateFolder(metadataString.subJenisFoto, jenisFotoFolderid);
      const subJenisFolderId = subJenisFolder.id;

      folderid = subJenisFolderId;

      if (metadataString.subSubJenisFoto != "") {
        // 5. sub sub jenis
        const subSubJenisFolder = await findOrCreateFolder(metadataString.subSubJenisFoto, subJenisFolderId);
        const subSubJenisFolderId = subSubJenisFolder.id;

        folderid = subSubJenisFolderId;
      }
    }

    const driveResponse = await uploadFilesToDrive(req.files, folderid, metadataString.namaFile);

    req.files.forEach(file => fs.unlinkSync(file.path));

    const uploadedFilesData = driveResponse.map((res, index) => ({
      id: res.id,
      // name: req.files[index].originalname, // Mengambil nama asli dari req.files
      name: res.name, // Mengambil nama asli dari req.files
      link: res.webViewLink
    }));

    const id = uploadedFilesData.map(function (item) {
      return item['id'];
    });

    const name = uploadedFilesData.map(function (item) {
      return item['name'];
    });

    const link = uploadedFilesData.map(function (item) {
      return item['link'];
    });

    metadataString.namaFile = name.toString();
    metadataString.fileId = id.toString();
    metadataString.fileLink = link.toString();

    //------
    //------
    const response = await axios.post(appsScriptWebAppUrl, metadataString, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "SETFOTO",
      },
    });
    res.send(response.data);
  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});


app.post('/del_foto', async (req, res) => {

  try {
    const fileIds = req.body['fileIds'];

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": "File Tidak Ditemukan" }))
    }

    const isSuccess = await deleteMultipleFilesFromDrive(fileIds);
    if (isSuccess) {
      req.body.fileIds = fileIds.toString();
      const response = await axios.post(appsScriptWebAppUrl, req.body, {
        headers: {
          'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
        },
        params: {
          operation: "DELFOTO",
        },
      });
      res.send(response.data);
    } else {
      res.json({
        "responseCode": "99",
        "responseMessage": "Gagal Menghapus File" // Gunakan error.message untuk pesan yang lebih baik
      });
    }
  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});


//========================================
//            VIDEO
//========================================
// app.get('/get_video', async (req, res) => {
//   try {
//     const response = await axios.get(appsScriptWebAppUrl, {
//       // Data yang dikirim sebagai query string (?nama=Alice)
//       params: {
//         operation: "GETVIDEO",
//       },
//     });
//     res.send(response.data);
//   } catch (error){
//     res.json({
//       "responseCode": "99",
//       "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
//     });
//   }
// });
app.post('/get_video', async (req, res) => {
  try {
    const response = await axios.post(appsScriptWebAppUrl, req.body, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "GETVIDEO",
      },
    });
    res.send(response.data);
  } catch (error) {
    res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });

  }
});

app.post('/set_video', upload.array('files'), async (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).send('Tidak ada file yang diunggah.');
  }

  try {
    const metadataString = req.body.metadata;

    // 1. folder utama
    const mainFolder = await findOrCreateFolder('VIDEO');
    const mainFolderId = mainFolder.id;

    // 2. lokasi
    const lokasiFolder = await findOrCreateFolder(metadataString.lokasi, mainFolderId);
    const lokasiFolderId = lokasiFolder.id;

    // 3. jenis
    const jenisFotoFolder = await findOrCreateFolder(metadataString.jenisVideo, lokasiFolderId);
    const jenisFotoFolderid = jenisFotoFolder.id;

    var folderid = jenisFotoFolderid;

    if (metadataString.sesi != "") {
      // 4. sub jenis
      const subJenisFolder = await findOrCreateFolder(metadataString.sesi, jenisFotoFolderid);
      const subJenisFolderId = subJenisFolder.id;

      folderid = subJenisFolderId;
    }

    const driveResponse = await uploadFilesToDrive(req.files, folderid, metadataString.namaFile);

    req.files.forEach(file => fs.unlinkSync(file.path));

    const uploadedFilesData = driveResponse.map(res => ({
      id: res.id,
      name: res.name, // <<-- Nama file dikembalikan dari respons Google Drive
      link: res.webViewLink
    }));

    const id = uploadedFilesData.map(function (item) {
      return item['id'];
    });

    const name = uploadedFilesData.map(function (item) {
      return item['name'];
    });

    const link = uploadedFilesData.map(function (item) {
      return item['link'];
    });

    metadataString.namaFile = name.toString();
    metadataString.fileId = id.toString();
    metadataString.fileLink = link.toString();

    //------
    const response = await axios.post(appsScriptWebAppUrl, metadataString, {
      headers: {
        'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
      },
      params: {
        operation: "SETVIDEO",
      },
    });
    res.send(response.data);

  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});


app.post('/del_video', async (req, res) => {
  try {
    const fileIds = req.body['fileIds'];

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": "File Tidak Ditemukan" }))
    }

    const isSuccess = await deleteMultipleFilesFromDrive(fileIds);
    if (isSuccess) {
      req.body.fileIds = fileIds.toString();
      const response = await axios.post(appsScriptWebAppUrl, req.body, {
        headers: {
          'Content-Type': 'application/json', // Opsional, tapi praktik yang baik
        },
        params: {
          operation: "DELETEVIDEO",
        },
      });
      res.send(response.data);
    } else {
      res.json({
        "responseCode": "99",
        "responseMessage": "Gagal Menghapus File" // Gunakan error.message untuk pesan yang lebih baik
      });
    }
  } catch (error) {
    // Respons khusus untuk error kredensial
    if (error.message === "11") {
      return res.json({
        "responseCode": "11",
        "responseMessage": "Silahkan Login Ulang" // Gunakan error.message untuk pesan yang lebih baik
      });
    }

    return res.json({
      "responseCode": "99",
      "responseMessage": error.message // Gunakan error.message untuk pesan yang lebih baik
    });
  }
});
//========================================
//                END
//========================================

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

