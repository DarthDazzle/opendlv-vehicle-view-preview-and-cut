var map

function statecheck(name,filePath) {
    var myLayer = document.getElementById(name + '_id');
    var folder = filePath.split("/")[3];
	//myLayer.style.backgroundColor = "#bff0a1";
	if(myLayer.checked == true){
		fetch('/linkFiles', { method: 'post',
                            headers: {
                                'Accept': 'application/json, text/plain, */*',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({fileName: name, folderName: folder})
                        }
        )
		} else {
        fetch('/unlinkFiles', { method: 'post',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({fileName: name})
        }
        )
	};
}

function loadMap(name, pathTest) {
    document.getElementById("demo").innerHTML = pathTest;
    map = L.map('mapid');
    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data &copy; <a href="http://www.osm.org">OpenStreetMap</a>'
    }).addTo(map);
    var gpx = pathTest + '.gpx'; // URL to your GPX file or the GPX itself
    new L.GPX(gpx, {async: true}).on('loaded', function(e) {
    map.fitBounds(e.target.getBounds());
    }).addTo(map);
}

var vid = document.getElementById("video");
var source = document.getElementById("vidSrc");
var namer = $('#fileNamer');
var bar = document.getElementById("progBar");
var preview = document.getElementById("previewWindow");
var $moveable = $('.timeStamp');
var elem = $('.progressBar');
var markerSec = 0;
var markerPos = 0;
var inMarker = new Date(0 * 1000).toISOString().substr(11, 8);
var outMarker = new Date(10000000 * 1000).toISOString().substr(11, 8);
var mapCreated = false;
var sourcename = ""

function cutFile() {
    var a = $('#sTime').val().split(':'); // split it at the colons
    var sTimePer = (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
    var a = $('#eTime').val().split(':'); // split it at the colons
    var eTimePer = (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
    var fileName = namer.val();

    var len = eTimePer - sTimePer;

    console.log(len)
    fetch('/cutfile', { method: 'post',
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({recordingFileToCut: sourcename, startTime: sTimePer, length: len, outName: fileName})
                    }
    )
    .then(function(response) {
        if(response.ok) {
            return;
        }
        throw new Error('Request failed.');
        })
    .catch(function(error) {
        console.log(error);
    });
}
vid.addEventListener("timeupdate", function() {
    var a = outMarker.split(':'); // split it at the colons
    var outseconds = (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
    var a = inMarker.split(':'); // split it at the colons
    var inseconds = (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
    if(vid.currentTime > outseconds) {
        vid.currentTime = inseconds
    }
    var position = (vid.currentTime - inseconds) / (vid.duration);
    bar.style.width = position * 100 + "%";

    
})

function eachLayer(layer){

}

function readURL(input, filePath) {
    var pathTest = '/' + filePath.split('/').slice(3, -1).join('/') + input ;
    preview.style.display = "block";
    source.src = pathTest + '.mp4';
    //namer.innerHTML = input
    namer.val(input);
    bar.style.width = 0 + "%";
    vid.load();
    vid.play();
    $('#inMarker').css({left: -9});
    $('#sTime').val(0);
    $('#eTime').val(100);
    $('#progBar').css({left: 0});
    $('#outMarker').css({left: ''});
    if (mapCreated != true) {
        loadMap(input, pathTest);
        mapCreated = true;
    } else {
        map.eachLayer(function(layer){
            map.remove();
            map.removeLayer(layer);
            latlngs = [];
            isMap = false;
            loadMap(input, pathTest);
        });        
    }
    sourcename = input;
    
}

function setInMarker() {
    var date = new Date(markerSec * 1000).toISOString().substr(11, 8);
    if (date < outMarker) {
        $('#sTime').val(date);
        $('#inMarker').css({left: markerPos - 9});
        $('#progBar').css({left: markerPos});
        vid.currentTime = markerSec;
        inMarker = date;
    }
}

function setOutMarker() {
    var date = new Date(markerSec * 1000).toISOString().substr(11, 8);
    if (date > inMarker) {
        $('#eTime').val(date);
        $('#outMarker').css({left: markerPos-9});
        outMarker = date;
    }
}


$(document).ready(function(){
   
    $('.progressBar').click(function (e) {
        var minX = elem.position().left;
        var maxX = elem.outerWidth();
        var x = e.pageX - elem.offset().left;
        totSec = (x - minX)/(maxX-minX)*vid.duration;
        vid.currentTime = totSec;
        vid.play();
    });
    $('.progressBar').mousemove(function(e){
        if($('.custom-menu').css('display') == 'none'){
            var minX = elem.position().left;
            var maxX = elem.outerWidth();
            var x = e.pageX;
            totSec = (x - minX)/(maxX-minX)*vid.duration;
            hrs = Math.floor(totSec/60/60);
            if (hrs>=1) {
                mins = Math.floor(totSec/60);
                secs = Math.round(totSec%60);
                if (mins < 10) {
                    mins = "0" + mins;
                }
                if (secs < 10) {
                    secs = "0" + secs;
                }
                $moveable.html(hrs + ":" + mins + ":" + secs);
            } else {
                mins = Math.floor(totSec/60);
                secs = Math.floor(totSec%60);
                if (mins < 10) {
                    mins = "0" + mins;
                }
                if (secs < 10) {
                    secs = "0" + secs;
                }
                $moveable.html(mins + ":" + secs);
                $moveable.css({'top': -25, 'left': x-80});
        }
        
        
    }
    });
  });


  $('.progressBar').bind("contextmenu", function (event) {
    var minX = elem.position().left;
    var maxX = elem.outerWidth();
    outMarker = new Date(vid.duration * 1000).toISOString().substr(11, 8);
    var x = event.pageX - elem.offset().left;
    totSec = (x - minX)/(maxX-minX)*vid.duration;
    markerSec = totSec;
    markerPos = x;
    // Avoid the real one
    event.preventDefault();
    
    // Show contextmenu
    $(".custom-menu").css({
        "display": "block",
        "top": event.pageY-90,
        "left": x
    });
});


// If the document is clicked somewhere
$(document).bind("mousedown", function (e) {
    
    // If the clicked element is not the menu
    if (!$(e.target).parents(".custom-menu").length > 0) {
        
        // Hide it
        $(".custom-menu").hide(100);
    }
});


// If the menu element is clicked
$(".custom-menu li").click(function(){
    
    // This is the triggered action name
    switch($(this).attr("data-action")) {
        
        // A case for each action. Your actions here
        case "mark_in": setInMarker(); break;
        case "mark_out": setOutMarker(); break;
    }
  
    // Hide it AFTER the action was triggered
    $(".custom-menu").hide(100);
  });