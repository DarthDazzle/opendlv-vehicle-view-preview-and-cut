// Copyright (C) 2018  Christian Berger
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Dependencies.
var dgram = require('dgram');
const fs = require('fs');
var express = require("express");
var exphbs  = require('express-handlebars');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const spawn = require('child_process').spawn;
var webrtc = require('wrtc'); // only on amd64

////////////////////////////////////////////////////////////////////////////////
var PORT = process.env.PORT || 8081;
var LIVE_OD4SESSION_CID = process.env.OD4SESSION_CID || 111;
var PLAYBACK_OD4SESSION_CID = process.env.PLAYBACK_OD4SESSION_CID || 253;
var OPENDLV_VEHICLE_VIEW_PLATFORM = process.env.OPENDLV_VEHICLE_VIEW_PLATFORM || "Snowfox";

////////////////////////////////////////////////////////////////////////////////
const PLATFORM_IS_SNOWFOX = "Snowfox" == OPENDLV_VEHICLE_VIEW_PLATFORM;
const PLATFORM_IS_RHINO = "Rhino" == OPENDLV_VEHICLE_VIEW_PLATFORM;
const PLATFORM_IS_KIWI = "Kiwi" == OPENDLV_VEHICLE_VIEW_PLATFORM;
const ENABLE_KIWI_SIMULATION = (process.env.OPENDLV_VEHICLE_VIEW_ENABLE_KIWI_SIMULATION == "1") || false;
var g_config = { g_vehicle: OPENDLV_VEHICLE_VIEW_PLATFORM,
                 platformIsSnowfox: PLATFORM_IS_SNOWFOX,
                 platformIsRhino: PLATFORM_IS_RHINO,
                 platformIsKiwi: PLATFORM_IS_KIWI,
                 enableKiwiSimulation: ENABLE_KIWI_SIMULATION };
var g_myVersion = "";
var g_myRemoteVersion = "";

////////////////////////////////////////////////////////////////////////////////
var g_fileToReplay = "";
var g_watchlive = true;

////////////////////////////////////////////////////////////////////////////////
// Killing process groups (used to stop cluon-OD4toStdout.
var psTree = require('ps-tree');

var kill = function (pid) {
    signal = 'SIGKILL';
    if (process.platform !== 'win32') {
        psTree(pid, function (err, children) {
            [pid].concat(
                children.map(function (p) {
                    return p.PID;
                })
            ).forEach(function (tpid) {
                try { process.kill(tpid, signal) }
                catch (e) {}
            });
        });
    }
};

////////////////////////////////////////////////////////////////////////////////
// Monitor load of Docker containers.
var g_systemLoad = "";
var monitorSystemLoad = function () {
    try {
        var monitorDocker = spawn('docker', ['stats', '--no-stream', '--format', '{"name":"{{.Name}}","container":"{{.Container}}","mem":"{{.MemPerc}}","cpu":"{{.CPUPerc}}"}']);

        monitorDocker.stdout.on('data', function (data) {
            g_systemLoad = data.toString();
        });
    } catch (e) {
        console.log(e);
    }
};

////////////////////////////////////////////////////////////////////////////////
// Web server.
var app = express();
var path = require('path');

// Template engine.
app.engine('.hbs', exphbs({extname: '.hbs'}));
app.set('view engine', '.hbs');


app.get("/playback", function(req, res) {
    var hasExternallySuppliedODVDFile = fs.existsSync("./external.odvd");
    var conf = { playbackPage: true,
                 useExternallySuppliedODVDFile: hasExternallySuppliedODVDFile,
                 fileToReplay: g_fileToReplay };
    conf = Object.assign(conf, g_config);
    res.render('main2', conf);
});

//------------------------------------------------------------------------------
// Handle existing recording files.
// Default landing page.

const addThousandsSeparator = (x) => {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
app.get("/", function(req, res) {
    var hasExternallySuppliedODVDFile = fs.existsSync("./external.odvd");
    var platform = process.arch.toString();
    var isX64 = platform == "x64";
    const recordingsFolder = '/opt/vehicle-view/recordings/';
    const recordingsFolderVM = '/opt/vehicle-view/recordingsVM/';
    const recordingsFolderUser = '/opt/vehicle-view/recordingsUser/';
    var files = { hasODVD: hasExternallySuppliedODVDFile, isX64: isX64, recfiles: [] };
    var generate = 1
    fs.access('./recordings/',fs.constants.W_OK, err => {
        if (err){
            generate = 0;
        }
    })
    
    fs.readdirSync(recordingsFolder).forEach(file => {
        var size = 0;
        var file_name = file.split('.',1);
        if (file.split('.').pop() == "rec") {
            size = fs.statSync(path.join(recordingsFolder + '/' + file_name +'.rec')).size;
            size = addThousandsSeparator(size);
            files.recfiles.push({
                "name"      : file_name,
                "filename"  : recordingsFolder + "/" + file_name +'.rec',
                "size"      : size,
                "inVM"      : 0,
                "userFile"  : 0,
                "generate"  : generate
            });
        }
        
    });
    fs.readdirSync(recordingsFolderUser).forEach(file => {
        var size = 0
        var file_name = file.split('.',1);
        if (file.split('.').pop() == "rec") {
            size = fs.statSync(path.join(recordingsFolderUser + '/' + file_name +'.rec')).size;
            size = addThousandsSeparator(size);
            files.recfiles.push({
                "name"      : file_name,
                "filename"  : recordingsFolderUser + "/" + file_name +'.rec',
                "size"      : size,
                "inVM"      : 0,
                "userFile"  : 1,
                "generate"  : 0
            });
        }
        
    });
    fs.readdirSync(recordingsFolderVM).forEach(file => {
        var file_name = file.split('.',1);
        
        if (file.split('.').pop() == "rec") {
            files.recfiles.forEach((recFile) => {
                var res = recFile['name'].toString().localeCompare(file_name)
                if (res == 0)
                {
                    recFile.inVM = 1
                }
            })
        }
        
    });
    res.render('main', files);
});


app.get("/details", function(req, res) {
    var hasExternallySuppliedODVDFile = fs.existsSync("./external.odvd");
    // Extract meta data from a rec-file.
    var output = "";
    try {
        output = execSync('if [ -f external.odvd ]; then rec-metadataToJSON --rec=./recordings/' + req.query.rec + ' --odvd=./external.odvd 2>/dev/null; else rec-metadataToJSON --rec=./recordings/' + req.query.rec + ' --odvd=./opendlv-standard-message-set-v0.9.9.odvd 2>/dev/null; fi', { shell: '/bin/bash' }).toString();
    }
    catch (e) {}

    output = output.trim();
    console.log("Extracted meta data: '" + output + "'"); // Expected: { "attributes": [ { "key": "keyA", "value":"valueA"} ] }

    var details = {
        hasODVD: hasExternallySuppliedODVDFile,
        name: req.query.rec,
        filename: './recordings/' + req.query.rec
    };

    // Concatenate meta data.
    if ( ('{' == output[0]) && ('}' == output[output.length-1]) ) {
        details = Object.assign(details, JSON.parse(output));

        var size = fs.statSync(path.join('./recordings/' + req.query.rec)).size;
        size = addThousandsSeparator(size);
        details.fileInformation.push({
            "key"       : "size:",
            "value"     : size + " bytes"
        });
    }

    // Return details page.
    res.render('details', details);
});

app.get("/detailsUser", function(req, res) {
    var hasExternallySuppliedODVDFile = fs.existsSync("./external.odvd");
    // Extract meta data from a rec-file.
    var output = "";
    try {
        output = execSync('if [ -f external.odvd ]; then rec-metadataToJSON --rec=./recordingsUser/' + req.query.rec + ' --odvd=./external.odvd 2>/dev/null; else rec-metadataToJSON --rec=./recordingsUser/' + req.query.rec + ' --odvd=./opendlv-standard-message-set-v0.9.9.odvd 2>/dev/null; fi', { shell: '/bin/bash' }).toString();
    }
    catch (e) {}

    output = output.trim();
    console.log("Extracted meta data: '" + output + "'"); // Expected: { "attributes": [ { "key": "keyA", "value":"valueA"} ] }

    var details = {
        hasODVD: hasExternallySuppliedODVDFile,
        name: req.query.rec,
        filename: './recordingsUser/' + req.query.rec
    };

    // Concatenate meta data.
    if ( ('{' == output[0]) && ('}' == output[output.length-1]) ) {
        details = Object.assign(details, JSON.parse(output));

        var size = fs.statSync(path.join('./recordingsUser/' + req.query.rec)).size;
        size = addThousandsSeparator(size);
        details.fileInformation.push({
            "key"       : "size:",
            "value"     : size + " bytes"
        });
    }

    // Return details page.
    res.render('details', details);
});

//------------------------------------------------------------------------------
// Handle POST requests.
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

app.post('/exportselectedmessages', (req, res) => {
    var newFileName = req.body.recordingFile.substr(0, req.body.recordingFile.lastIndexOf(".rec")) + "-selection.rec";
    var process_cluonfilter = execSync('rm -f ' + newFileName + ' && cat ' + req.body.recordingFile + ' | cluon-filter ' + req.body.keepString + ' > ' + newFileName);
    console.log('[opendlv-vehicle-view] Started cluon-filter, PID: ' + process_cluonfilter.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});
app.post('/provideodvdfile', (req, res) => {
    if (0 < req.body.odvd.length) {
        const folder = '.';
        fs.writeFile(path.join(folder + '/' + "external.odvd"), req.body.odvd, function(err) {
            if (err) {
                return console.log(err);
            }
        });
    }

    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});
app.post('/deleteodvdfile', (req, res) => {
    fs.unlink("./external.odvd", function() {
        res.send ({
            status      : "200",
            responseType: "string",
            response    : "success"
        });
    });
});
app.post('/convertrec2csv', (req, res) => {
    var process_cluonrec2csv = execSync('rm -f ' + req.body.recordingFile + '.csv.zip && if [ -f external.odvd ]; then cluon-rec2csv --rec=' + req.body.recordingFileToConvert + ' --odvd=external.odvd; else cluon-rec2csv --rec=' + req.body.recordingFileToConvert + ' --odvd=opendlv-standard-message-set-v0.9.9.odvd; fi && rm -f comments.tmp && if [ -f opendlv.system.LogMessage-999.csv ]; then for i in $(cat opendlv.system.LogMessage-999.csv | sed 1d | cut -f8 -d";"|cut -f2 -d"\\""); do echo $i | base64 -di >> comments.tmp && echo "" >> comments.tmp; done && cat opendlv.system.LogMessage-999.csv | sed 1d | cut -f1-7 -d";" | paste -d ";" - comments.tmp | sed -e \'s/$/;/\' > comments.tmp2 && cat opendlv.system.LogMessage-999.csv | head -n1 > comments && cat comments.tmp2 >> comments && rm comments.tmp comments.tmp2 && mv comments opendlv.system.LogMessage-999-comments.csv; fi && zip ./' + req.body.recordingFile + '.csv.zip *.csv && rm -f *.csv', { shell: '/bin/bash' });
    console.log('[opendlv-vehicle-view] Started cluon-rec2csv, PID: ' + process_cluonrec2csv.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});

app.post('/convertrec2csvpng', (req, res) => {
    var process_cluonrec2csvpng = execSync('if [ "$(docker images -q chalmersrevere/rec2csv-png:v0.0.4 2> /dev/null)" == "" ]; then docker build -t chalmersrevere/rec2csv-png:v0.0.4 https://github.com/chalmers-revere/rec2csv-png.git; fi && rm -f ' + req.body.recordingFile + '.csv.zip && mkdir -p recordings/tmp && if [ -f external.odvd ]; then cp external.odvd recordings/tmp/messages.odvd; else cp opendlv-standard-message-set-v0.9.9.odvd recordings/tmp/messages.odvd; fi && docker run --rm --volumes-from=opendlv-vehicle-view -w /opt/vehicle-view/recordings/tmp chalmersrevere/rec2csv-png:v0.0.4 --rec=../' + req.body.recordingFile + ' --odvd=messages.odvd && cd recordings/tmp && rm -f comments.tmp && if [ -f opendlv.system.LogMessage-999.csv ]; then for i in $(cat opendlv.system.LogMessage-999.csv | sed 1d | cut -f8 -d";"|cut -f2 -d"\\""); do echo $i | base64 -di >> comments.tmp && echo "" >> comments.tmp; done && cat opendlv.system.LogMessage-999.csv | sed 1d | cut -f1-7 -d";" | paste -d ";" - comments.tmp | sed -e \'s/$/;/\' > comments.tmp2 && cat opendlv.system.LogMessage-999.csv | head -n1 > comments && cat comments.tmp2 >> comments && rm comments.tmp comments.tmp2 && mv comments opendlv.system.LogMessage-999-comments.csv; fi && zip -r9 ../../' + req.body.recordingFile + '.csv.zip *.csv opendlv.proxy.ImageReading* && cd .. && rm -fr tmp && cd ..', { shell: '/bin/bash' });

    console.log(process_cluonrec2csvpng.toString());

    console.log('[opendlv-vehicle-view] Started cluon-rec2csvpng, PID: ' + process_cluonrec2csvpng.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});

app.post('/linkFiles',(req,res) => {
    var process_linkFile = execSync('cp ./' + req.body.folderName + '/' + req.body.fileName + '.rec ./recordingsVM/' + req.body.fileName +'.rec');

    console.log('[opendlv-vehicle-view] Started cluon-rec2csvpng, PID: ' + process_linkFile.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});

app.post('/unlinkFiles',(req,res) => {
    var process_linkFile = execSync('rm ./recordingsVM/' + req.body.fileName +'.rec');

    console.log('[opendlv-vehicle-view] Started cluon-rec2csvpng, PID: ' + process_linkFile.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});

app.post('/convertrec2webm', (req, res) => {
    var process_cluonrec2webm = execSync('if [ "$(docker images -q chalmersrevere/rec2csv-png:v0.0.4 2> /dev/null)" == "" ];then docker build -t chalmersrevere/rec2csv-png:v0.0.4 https://github.com/chalmers-revere/rec2csv-png.git; fi && rm -f ' + req.body.recordingFile + '.webm.zip && mkdir -p recordings/tmp && if [ -f external.odvd ]; then cp external.odvd recordings/tmp/messages.odvd; else cp opendlv-standard-message-set-v0.9.9.odvd recordings/tmp/messages.odvd; fi && docker run --rm --volumes-from=rec-preview -w /opt/vehicle-view/recordings/tmp chalmersrevere/rec2csv-png:v0.0.4 --rec=../' + req.body.recordingFile + '.rec --odvd=messages.odvd && docker run --rm --volumes-from=rec-preview -w /opt/vehicle-view/recordings/tmp --entrypoint="" chalmersrevere/rec2csv-png:v0.0.4 /usr/bin/generate_webm.sh && cd recordings/tmp && zip -r9 ../../' + req.body.recordingFile + '.webm.zip *.webm && cd .. && rm -fr tmp && cd ..', { shell: '/bin/bash' });

    console.log(process_cluonrec2webm.toString());

    console.log('[opendlv-vehicle-view] Started cluon-rec2csvpng, PID: ' + process_cluonrec2webm.pid);
    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});

var g_replayRunning = false;
var g_cluonreplay;
app.post('/replayrecfile', (req, res) => {
    g_replayRunning = true;
    g_fileToReplay = req.body.recordingFileToPlay;
    g_cluonreplay = exec('sleep 2 && cluon-replay --keeprunning --cid=' + PLAYBACK_OD4SESSION_CID + ' ' + req.body.recordingFileToPlay);
    console.log('[opendlv-vehicle-view] Started cluon-replay, PID: ' + g_cluonreplay.pid);
    console.log('Test: ' + g_fileToReplay)

    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});


app.post('/cutfile', (req, res) => {
    g_fileToReplay = req.body.recordingFileToCut;
    g_startTime = req.body.startTime;
    g_length = req.body.length;
    ffmp_startTime = '' + Math.floor(g_startTime/60/60) +':' + Math.floor(g_startTime/60) + ':' + g_startTime;
    ffmp_length = '' + Math.floor(g_length/60/60) +':' + Math.floor(g_length/60) + ':' + g_length;
    g_name = req.body.outName;
    cmd = '/opt/vehicle-view/cut/rec_splitter .' + g_fileToReplay + '.rec ' + g_name + ' ' + g_startTime + ' ' + g_length;
    
// PythonCut    g_cluonreplay = exec('python3 /opt/vehicle-view/cut/rec-file-splitter/python3/rec_splitter.py -r ' + '/opt/vehicle-view/recordings/' + g_fileToReplay + ' -s ' + g_startTime + ' -i' + g_length);
    g_cluoncut = exec(cmd, function callback(error, stdout, stderr) {
    });
    cmd = 'ffmpeg -i .' + g_fileToReplay + '.mp4 -ss ' + ffmp_startTime + ' -t ' + ffmp_length + ' ./recordingsUser/' + g_name + '.mp4';
    console.log(cmd);
    g_mp4cut = exec(cmd, function callback(error, stdout, stderr){
        res.send ({
            status      : "200",
            responseType: "string",
            response    : "success"
    });
});
    console.log('Stated splitting: ' + g_cluoncut.pid);
    console.log('Stated splitting: ' + g_mp4cut.pid);

    
});

app.post('/create_gpx', (req, res) => {
    g_fileToGenGPX = req.body.recordingFileToGenGPX;
    g_duration = req.body.length;
    cmd = '/opt/vehicle-view/cut/gpx_creator ' + g_fileToGenGPX ;
    console.log(cmd);
    g_genGPX = exec(cmd, function callback(error, stdout, stderr){
        res.send ({
            status      : "200",
            responseType: "string",
            response    : "success"
    });
});
console.log('Stated splitting: ' + g_genGPX.pid);
});

app.post('/endreplay', (req, res) => {
    try { kill(g_cluonreplay.pid); } catch (e) { console.log(e); }
    console.log('[opendlv-vehicle-view] Stopped cluon-replay, PID: ' + g_cluonreplay.pid);

    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
    g_replayRunning = false;
    g_fileToReplay = "";
});
app.post('/deleterecfile', (req, res) => {
    fs.unlink(req.body.recordingFileToDelete, function() {
        res.send ({
            status      : "200",
            responseType: "string",
            response    : "success"
        });
    });
});

//------------------------------------------------------------------------------
// Server-side update stream of Docker system load.
app.get('/systemloadupdates', function(req, res) {
    res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive'
        });
    res.write('\n');

    setInterval(function() {
        monitorSystemLoad();
        var listOfLoads = "[" + g_systemLoad.replace(/\n/g, ',') + "]";
        listOfLoads = listOfLoads.replace(/,]$/, ']');
        res.write('data: ' + listOfLoads);
        res.write('\n');
        res.write('\n');
    }, 5000);
});

//------------------------------------------------------------------------------
// Serve other static files.
app.get(/^(.+)$/, function(req, res){
    res.sendFile(path.join(__dirname + '/' + req.params[0]));
});

//------------------------------------------------------------------------------
// Start server.
var server = app.listen(PORT, function () {
    {
        try {
            g_myVersion = execSync('docker inspect `cat /proc/self/cgroup | head -1 | cut -d ":" -f 3 | cut -d "/" -f 3` | grep "Image" | grep -v "sha256" | cut -d "\\"" -f 4 | cut -f2 -d":"', { shell: '/bin/bash' }).toString();
        }
        catch (e) {}
        g_myVersion.trim();
        g_myVersion = g_myVersion.slice(0, -1);
    }

    {
        try {
            g_myRemoteVersion = execSync("curl -sL https://registry.hub.docker.com/v1/repositories/chalmersrevere/opendlv-vehicle-view-multi/tags |sed  -e 's|}|\\n|g'|cut -f8 -d'\"'|tail -n4|head -n1", { shell: '/bin/bash' }).toString();
        }
        catch (e) {}
        g_myRemoteVersion.trim();
        g_myRemoteVersion = g_myRemoteVersion.slice(0, -1);
    }

    console.log('[opendlv-vehicle-view (' + g_myVersion + ')] Web server listening on port: ' + PORT + ', joining live OD4Session ' + LIVE_OD4SESSION_CID + ', using OD4Session ' + PLAYBACK_OD4SESSION_CID + ' for playback.');

    try {
        // Remove potentially existing external ODVD file.
        fs.unlink(path.join("./external.odvd"), function(){});
    }
    catch (e) {}
    try {
        // Remove potentially existing zip archives.
        fs.unlink(path.join("./*.zip"), function(){});
    }
    catch (e) {}
})

////////////////////////////////////////////////////////////////////////////////
// Websocket stuff.
var g_cluonOD4toStdout;
const WebSocket = require('ws').Server;
const g_ws = new WebSocket({server});
var g_latestWSConnection = null;
g_ws.on('connection', function connection(conn) {
    conn.on('close', function(reasonCode, description) {
        // Connection closed.
        // Reset watching live.
        if (!g_watchlive) {
            console.log("[opendlv-vehicle-view] Connection lost; re-enabling data forwarding from live session.");
        }
        g_watchlive = true;
    });
    conn.on('message', function(msg) {
        try {
            if ( /* Ensure we have pure JSON. */ (msg[0] == '{') && (msg[msg.length-1] == '}') ) {
                var data = JSON.parse(msg);
                Object.keys(data).forEach(function(key) {
                    if ('record' == key) {
                        if (data.record) {
                            g_cluonOD4toStdout = exec('cluon-OD4toStdout --cid=' + LIVE_OD4SESSION_CID + ' > ./recordings/`date +CID-' + LIVE_OD4SESSION_CID + '-recording-%Y-%m-%d_%H%M%S.rec`');
                            console.log('[opendlv-vehicle-view] Started cluon-OD4toStdout, PID: ' + g_cluonOD4toStdout.pid);
                        }
                        else {
                            try { kill(g_cluonOD4toStdout.pid); } catch (e) { console.log(e); }
                            console.log('[opendlv-vehicle-view] Stopped cluon-OD4toStdout, PID: ' + g_cluonOD4toStdout.pid);
                        }
                    }
                    if ('watchlive' == key) {
                        g_watchlive = data.watchlive;
                        if (data.watchlive) {
                            console.log('[opendlv-vehicle-view] Enabling data forwarding from live session.');
                        }
                        else {
                            console.log('[opendlv-vehicle-view] Disabling data forwarding from live session.');
                        }
                    }
                    if ('remoteplayback' == key) {
                        // Unpack Proto-encoded Envelope and forward command to playback OD4Session.
                        g_playbackOD4Session.send(Buffer.from(data.remoteplayback, 'base64'), 12175, '225.0.0.' + PLAYBACK_OD4SESSION_CID);
                    }
                    if ('remoterecord' == key) {
                        // Unpack Proto-encoded Envelope and forward command to live OD4Session.
                        g_liveOD4Session.send(Buffer.from(data.remoterecord, 'base64'), 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                    if ('logmessage' == key) {
                        // Unpack Proto-encoded Envelopes...
                        var envLogMessage = Buffer.from(data.logmessage, 'base64');

                        // ...and forward command to live OD4Session.
                        g_liveOD4Session.send(envLogMessage, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                    if ('virtualjoystick' == key) {
                        // Unpack Proto-encoded Envelopes...
                        var envPedalPositionRequest = Buffer.from(data.virtualjoystick.pedalPositionRequest, 'base64');
                        var envGroundSteeringRequest = Buffer.from(data.virtualjoystick.groundSteeringRequest, 'base64');
                        var envActuationRequest = Buffer.from(data.virtualjoystick.actuationRequest, 'base64');

                        // ...and forward command to live OD4Session.
                        g_liveOD4Session.send(envPedalPositionRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                        g_liveOD4Session.send(envGroundSteeringRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                        g_liveOD4Session.send(envActuationRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                    if ('virtualjoystickCalibration' == key) {
                        var envCalibrationSteeringRequest = Buffer.from(data.virtualjoystickCalibration.calibrationSteeringRequest, 'base64');
                        g_liveOD4Session.send(envCalibrationSteeringRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                    if ('getWebRTCOffer' == key) {
                        g_latestWSConnection = conn;
                        makeOffer();
                    }
                    if ('joinerSDP' == key) {
                        var joinerSDP = JSON.parse(data.joinerSDP);
                        var answer = new webrtc.RTCSessionDescription(joinerSDP);
                        g_pc.setRemoteDescription(answer);
                    }
                    if ('webRTCclientState' == key) {
                        if ("failed" == data.webRTCclientState) {
                            console.log("[opendlv-vehicle-view] WebRTC failed; falling back to WebSockets.");
                            g_channel = null;
                            g_useWebRTC = false;
                        }
                    }
                });
            }
        }
        catch (e) {}
    });
});

////////////////////////////////////////////////////////////////////////////////
// Broadcast to connected websocket clients.
var broadcastMessage = function (msg, fromLive) {
    if ( ( (fromLive && !g_replayRunning) /* Forward either from live OD4Session */ ) ||
         ( (!fromLive && g_replayRunning) /* or from replay OD4Session but not from both. */ ) ) {
        var failed = false;
        try {
            if ( (null != g_channel) && (g_useWebRTC) && g_watchlive ) {
                // Use WebRTC.
                g_channel.send(msg);
            }
        } catch(e) {
            failed = true;
        }

        if ( (null == g_channel) || (!g_useWebRTC) || failed) {
            if (g_watchlive) {
                g_ws.clients.forEach(function each(client) {
                    if (client.readyState == 1 /*WebSocket.OPEN*/) {
                        client.send(msg);
                    }
                });
            }
        }
    }
};

////////////////////////////////////////////////////////////////////////////////
// Connect to live OD4Session to broadcast messages to connected websocket clients.
var g_liveOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
g_liveOD4Session.bind({ 'port' : 12175 /* OD4Session UDP multicast port */, 'address': '225.0.0.' + LIVE_OD4SESSION_CID, 'exclusive' : false });
g_liveOD4Session.on('listening', function() {
    g_liveOD4Session.addMembership('225.0.0.' + LIVE_OD4SESSION_CID);
});
g_liveOD4Session.on('message', function(msg, rinfo) {
    broadcastMessage(msg, true);
});

////////////////////////////////////////////////////////////////////////////////
// Connect to playback OD4Session to broadcast messages to connected websocket clients.
var g_playbackOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
g_playbackOD4Session.bind({ 'port' : 12175 /* OD4Session UDP multicast port */, 'address': '225.0.0.' + PLAYBACK_OD4SESSION_CID, 'exclusive' : false });
g_playbackOD4Session.on('listening', function() {
    g_playbackOD4Session.addMembership('225.0.0.' + PLAYBACK_OD4SESSION_CID);
});
g_playbackOD4Session.on('message', function(msg, rinfo) {
    broadcastMessage(msg, false);
});

////////////////////////////////////////////////////////////////////////////////
// WebRTC connection.
var g_useWebRTC = false;
var g_pc = null;
var g_channel = null;
var g_pcSettings = [
  {
    iceServers: [{url:'stun:stun.l.google.com:19302'}]
  },
  {
    'optional': [{DtlsSrtpKeyAgreement: false}]
  }
];

function doHandleError(error) {
    throw error;
}
function onsignalingstatechange(state) {
//    console.log('[opendlv-vehicle-view] signaling state change: ' + g_pc.signalingState);
}
function oniceconnectionstatechange(state) {
    console.log('[opendlv-vehicle-view] WebRTC: ICE connection state change:' + g_pc.iceConnectionState);
}
function onicegatheringstatechange(state) {
//    console.log('[opendlv-vehicle-view] ice gathering state change: ' + g_pc.iceGatheringState);
}

function makeDataChannel() {
    // If you don't make a datachannel *before* making your offer (such
    // that it's included in the offer), then when you try to make one
    // afterwards it just stays in "connecting" state forever.  This is
    // my least favorite thing about the datachannel API.
    g_channel = g_pc.createDataChannel('OD4', {reliable:false, maxRetransmits:0});
    g_channel.binaryType = "arraybuffer";
    g_channel.onopen = function() {
        console.log("[opendlv-vehicle-view] WebRTC: Connection established.");
        g_useWebRTC = true;
    };
    g_channel.onmessage = function(evt) {
        var msg = evt.data;
        try {
            if ( /* Ensure we have pure JSON. */ (msg[0] == '{') && (msg[msg.length-1] == '}') ) {
                var data = JSON.parse(msg);
                Object.keys(data).forEach(function(key) {
                    if ('virtualjoystick' == key) {
                        // Unpack Proto-encoded Envelopes...
                        var envPedalPositionRequest = Buffer.from(data.virtualjoystick.pedalPositionRequest, 'base64');
                        var envGroundSteeringRequest = Buffer.from(data.virtualjoystick.groundSteeringRequest, 'base64');
                        var envActuationRequest = Buffer.from(data.virtualjoystick.actuationRequest, 'base64');

                        // ...and forward command to live OD4Session.
                        g_liveOD4Session.send(envPedalPositionRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                        g_liveOD4Session.send(envGroundSteeringRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                        g_liveOD4Session.send(envActuationRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                    if ('virtualjoystickCalibration' == key) {
                        var envCalibrationSteeringRequest = Buffer.from(data.virtualjoystickCalibration.calibrationSteeringRequest, 'base64');
                        g_liveOD4Session.send(envCalibrationSteeringRequest, 12175, '225.0.0.' + LIVE_OD4SESSION_CID);
                    }
                });
            }
        }
        catch (e) {}
    };
    g_channel.onerror = doHandleError;
}

function makeOffer() {
    g_pc = new webrtc.RTCPeerConnection(g_pcSettings);
    makeDataChannel();
    g_pc.onsignalingstatechange = onsignalingstatechange;
    g_pc.oniceconnectionstatechange = oniceconnectionstatechange;
    g_pc.onicegatheringstatechange = onicegatheringstatechange;
    g_pc.createOffer(function (desc) {
        g_pc.setLocalDescription(desc, function () {}, function (err) {});
        // We'll pick up the offer text once trickle ICE is complete, in onicecandidate.
        }, function (err) {
         console.log("Error ", err);
    });

    g_pc.onicecandidate = function(candidate) {
        // Firing this callback with a null candidate indicates that
        // trickle ICE gathering has finished, and all candidates
        // are now present in g_pc.localDescription. Waiting until now
        // to create the answer saves us from having to send offer +
        // answer + iceCandidates separately.
        if (candidate.candidate == null) {
            var myOffer = JSON.stringify(g_pc.localDescription);
            var myOfferJSON = { webRTCOffer : myOffer };
            if (null != g_latestWSConnection) {
                if (g_latestWSConnection.readyState == 1 /*WebSocket.OPEN*/) {
                    g_latestWSConnection.send(JSON.stringify(myOfferJSON));
                }
            }
        }
    }
}

