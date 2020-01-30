    function handleDragOver(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
    }

    function handleFileSelect(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        var files = evt.dataTransfer.files; // FileList object.

        // files is a FileList of File objects. List some properties.
        var output = [];
        if (1 != files.length) {
            alert("Cannot handle more than one message specification file (.odvd).");
        }
        else if (1024*1024 < files[0].size) {
            alert("Cannot handle message specification files (.odvd) that are larger than 1MB.");
        }
        else {
            var reader = new FileReader();

            reader.onload = function(e) {
                var content = reader.result;
                var __libcluon = libcluon();
                var res = "0";
                try {
                    // Always add the messages to control the remote player and to actuation request.
                    var playerMessages = `

message cluon.data.PlayerCommand [id = 9] {
    uint8 command [id = 1]; // 0 = nothing, 1 = play, 2 = pause, 3 = seekTo, 4 = step
    float seekTo [id = 2];
}

message cluon.data.PlayerStatus [id = 10] {
    uint8 state [id = 1]; // 0 = unknown, 1 = loading file, 2 = playback
    uint32 numberOfEntries [id = 2];
    uint32 currentEntryForPlayback [id = 3];
}

message cluon.data.RecorderCommand [id = 11] {
    uint8 command [id = 1]; // 0 = nothing, 1 = record, 2 = stop
}

// This message is a legacy one to support controlling Snowfox and Rhino.
message opendlv.proxy.ActuationRequest [id = 160] {
  float acceleration [id = 1];
  float steering [id = 2];
  bool isValid [id = 3];
}
`;
                    content += playerMessages;
                    res = __libcluon.setMessageSpecification(content);
                }
                catch (e) {
                    res = "0";
                }

                if ("0" != res) {
                    if (confirm("Do you want to upload the provided message specification file?")) {
                        fetch('/provideodvdfile', { method: 'post',
                                            headers: {
                                                'Accept': 'application/json, text/plain, */*',
                                                'Content-Type': 'application/json'
                                            },
                                            body: JSON.stringify({odvd: content})
                                           }
                        )
                        .then(function(response) {
                            if (response.ok) {
                                location.reload();
                                return;
                            }
                            throw new Error('Request failed.');
                            })
                        .catch(function(error) {
                            console.log(error);
                        });
                    }
                }
                else {
                    alert("Provided message specification file contained " + res + " messages.");
                }
            }

            reader.readAsText(files[0]);
        }
    }

    // Connect drag-and-drop listeners.
    var dropZone = document.getElementById('drop_zone');
    dropZone.addEventListener('dragover', handleDragOver, false);
    dropZone.addEventListener('drop', handleFileSelect, false);

function deleteExternallySuppliedODVDFile() {
    if (confirm("Do you really want to remove previously provided message specification file?")) {
        fetch('/deleteodvdfile', { method: 'post',
                                   headers: {
                                       'Accept': 'application/json, text/plain, */*',
                                       'Content-Type': 'application/json'
                                   } }
        )
        .then(function(response) {
            if(response.ok) {
                location.reload();
                return;
            }
            throw new Error('Request failed.');
            })
        .catch(function(error) {
            console.log(error);
        });
    }
}