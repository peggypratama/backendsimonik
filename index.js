const express = require('express');
const cors = require("cors");
const axios = require('axios');
const { json } = require('body-parser');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

//========================================

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;
const appsScriptWebAppUrl = "https://script.google.com/macros/s/AKfycbyYiTMMlIlnLR2Uf2Wd4AS4MHppgqALN85d25gAKTFMPTEPPYHaHA_PQ4ytmgL3ImAg/exec";

//==========================================

// Load credentials from the downloaded JSON file
const credentials = require('./client_secret_37179113405-posa9o1dl97bi75m6c3dgm79fatal6vo.apps.googleusercontent.com.json');
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const upload = multer({ dest: 'uploads/' });

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

app.post('/login', (req, res) => {
  // console.log(req.body['username']);
  // console.log(req.body['password']);
  // console.log(req.params);

  axios.get(appsScriptWebAppUrl + "?operation=CHECKUSER&username=" + req.body['username'] + "&password=" + req.body['password'])
    .then(response => {
      const authorizeUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        // state: req.query.param
      });

      console.log('Response from Apps Script:', response.data);
      response.data.authorizeUrl = authorizeUrl;
      res.send(response.data);
      // res.redirect(`/auth?param=${JSON.stringify(response.data)}`)
    })
    .catch(error => {
      console.error('Error making GET request:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.get('/auth', (req, res) => {
  console.log(`/auth ${req.query.param}`)
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    // state: req.query.param
  });

  console.log(authorizeUrl)
  res.redirect(authorizeUrl);

});

app.get('/oauth2callback', async (req, res) => {
  console.log("Masuk Sini")
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  res.send('Autentikasi berhasil! Anda sekarang dapat mengunggah file.');
});

//==================================================================================
/**
 * Mencari folder di Google Drive berdasarkan nama.
 * Jika tidak ditemukan, akan dibuat.
 * @param {string} folderName Nama folder yang ingin dicari/dibuat.
 * @returns {string} ID folder.
 */

/* async function findOrCreateFolder(drive, folderName) {
  const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({
    q: q,
    fields: 'files(id)',
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  } else {
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    const newFolder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
    });
    return newFolder.data.id;
  }
} */

/**
 * Mencari atau membuat folder di Google Drive.
 * @param {string} folderName Nama folder yang ingin dibuat atau dicari.
 * @param {string} parentId ID folder induk (opsional).
 * @returns {Promise<object>} Objek yang berisi ID dan nama folder.
 */


async function findOrCreateFolder(folderName, parentId = null) {
  const drive = google.drive({ version: 'v3', auth });

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
    console.log(`Folder '${existingFolder.name}' sudah ada. Menggunakan ID: ${existingFolder.id}`);
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
    console.log(`Folder '${createResponse.data.name}' berhasil dibuat dengan ID: ${createResponse.data.id}`);
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
  try {
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.delete({
      fileId: fileId,
    });

    console.log(`File dengan ID: ${fileId} berhasil dihapus.`);
    return true;
  } catch (error) {
    console.error('Terjadi error saat menghapus file:', error);
    throw error; // Lempar error untuk ditangani di endpoint
  }
}

async function uploadFileToDrive(file, fileName, folderId) {
  if (!oAuth2Client.credentials.access_token) {
    return res.status(401).send('Akses tidak terotentikasi. Silakan otentikasi melalui /auth terlebih dahulu.');
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
    fields: 'id, webViewLink', // Meminta webViewLink
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

//========================================
//                 LOKASI
//========================================

app.get('/get_lokasi', (req, res) => {
  let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: appsScriptWebAppUrl + "?operation=GETLOKASI",
    headers: {}
  };

  axios.request(config)
    .then(response => {
      console.log('Response from Apps Script:', response.data);

      res.header('Access-Control-Allow-Credentials', true);

      res.send(response.data);
    })
    .catch(error => {
      console.error('Error making GET request:', error);
      res.header('Access-Control-Allow-Credentials', true);

      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/set_lokasi', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=SETLOKASI", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/del_lokasi', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=DELLOKASI", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/edit_lokasi', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=EDITLOKASI", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

//========================================
//            USER
//========================================

app.get('/get_user', (req, res) => {
  let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: appsScriptWebAppUrl + "?operation=GETUSER",
    headers: {}
  };

  axios.request(config)
    .then(response => {
      console.log('Response from Apps Script:', response.data);

      res.header('Access-Control-Allow-Credentials', true);

      res.send(response.data);
    })
    .catch(error => {
      console.error('Error making GET request:', error);
      res.header('Access-Control-Allow-Credentials', true);

      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/set_user', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=SETUSER", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/del_user', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=DELUSER", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

//========================================
//            BERITA ACARA
//========================================


app.post('/set_berita_acara', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Tidak ada file yang diunggah.');
  }

  try {
    const metadataString = req.body.metadata;
    console.log(metadataString);

    // 1. folder utama
    const mainFolder = await findOrCreateFolder('BERITA ACARA');
    const mainFolderId = mainFolder.id;

    // 2. sub-folder di dalam folder utama
    const subFolder = await findOrCreateFolder(metadataString.jenisBeritaAcara, mainFolderId);
    const subFolderId = subFolder.id;


    // 3. sub-sub-folder di dalam sub folder
    const subSubFolder = await findOrCreateFolder(metadataString.lokasi, subFolderId);
    const subSubFolderId = subSubFolder.id;


    const driveResponse = await uploadFileToDrive(req.file, metadataString.fileName, subSubFolderId);
    const fileName = driveResponse.originalname;
    console.log(`File Name ${fileName}`)
    const fileLink = driveResponse.webViewLink;
    const fileId = driveResponse.id;

    // metadataString.fileName = fileName;
    metadataString.fileLink = fileLink;
    metadataString.fileId = fileId;

    //Upload dlu ke sheet

    console.log(metadataString);
    //------
    axios.post(appsScriptWebAppUrl + "?operation=SETBERITAACARA", metadataString, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .then(response => {
        console.log('Success:', response.data);

        res.send(response.data);

        fs.unlinkSync(req.file.path);
      })
      .catch(error => {
        console.error('Error:', error);
        res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))

        fs.unlinkSync(req.file.path);
      });

  } catch (error) {
    console.error('Error:', error);
    res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
  }
});


app.post('/edit_berita_acara', (req, res) => {
  axios.post(appsScriptWebAppUrl + "?operation=EDITBERITAACARA", req.body, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('Success:', response.data);

      res.send(response.data);

    })
    .catch(error => {
      console.error('Error:', error);
      res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
    });
});

app.post('/del_berita_acara', async (req, res) => {
  const { fileId } = req.body.fileId;

  if (!fileId) {
    res.send(JSON.parse({ "responseCode": "99", "responseMessage": "File Tidak Ditemukan" }))
  }

  try {

    var del = await deleteFileFromDrive(fileId);
    if (del) {
      axios.post(appsScriptWebAppUrl + "?operation=DELBERITAACARA", req.body, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(response => {
          console.log('Success:', response.data);

          res.send(response.data);

        })
        .catch(error => {
          console.error('Error:', error);
          res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
        });
    }
  } catch (e) {
    console.error('Error:', error);
    res.send(JSON.parse({ "responseCode": "99", "responseMessage": error }))
  }
});
//========================================
//                END
//========================================

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

