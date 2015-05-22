var angular = require('angular');
var angularMaterial = require('angular-material');
var angularAnimate = require('angular-animate');
var angularAria = require('angular-aria');
var Promise = require('bluebird');
var adb = require('adbkit');
var fs = require('fs');
var StreamPng = require('StreamPng');
var client = adb.createClient();
var moment = require('moment');

angular.module('snapperApp', ['ngMaterial', 'ngAnimate', 'ngAria'])
.config(function($mdThemingProvider) {
  $mdThemingProvider.theme('default')
  .primaryPalette('blue')
  .accentPalette('red')
  .dark();
})
.controller('AppCtrl', ['$scope', '$timeout', '$mdBottomSheet', function ($scope, $timeout, $mdBottomSheet) {

  $scope.targetDevice = '';
  $scope.switch = '';
  $scope.recording = false;
  $scope.loading = false;

  $scope.isVid = function() {
    return $scope.switch.case == 'vid';
  }

  $scope.screenCapture = function() {
    if ($scope.targetDevice && $scope.targetDevice.length) {
      $scope.loading = true;
      screencap($scope.targetDevice, function(err) {
        $scope.$apply(function() {
          $scope.loading = false;
        });
      });
    } else {
      client.listDevices()
      .then(function(devices) {
        if(devices.length === 1) {
          $scope.targetDevice = devices[0].id;
          $scope.loading = true;
          screencap($scope.targetDevice, function(err) {
            $scope.$apply(function() {
              $scope.loading = false;
            });
          });
        } else if(devices.length > 1) {
          console.log("Tell a user to pick one...");
        } else {
          console.log("No device connected...");
        }
      });
    }
  }

  $scope.toggleRecording = function() {
    if($scope.recording) {
      $scope.stopRecord();
    } else {
      $scope.screenrecord();
    }
  }

  $scope.screenrecord = function() {
    if ($scope.targetDevice && $scope.targetDevice.length) {
      screenrecord($scope.targetDevice);
      $scope.recording = true;
    } else {
      client.listDevices()
      .then(function(devices) {
        if(devices.length === 1) {
          $scope.targetDevice = devices[0].id;
          screenrecord($scope.targetDevice);
          $scope.recording = true;
        } else if(devices.length > 1) {
          console.log("Tell a user to pick one...");
        } else {
          console.log("No device connected...");
        }
      });
    }
  }

  $scope.stopRecord = function() {
    if ($scope.targetDevice && $scope.targetDevice.length) {
      $scope.loading = true;
      stopAndPull($scope.targetDevice, function(err) {
        $scope.$apply(function() {
          $scope.loading = false;
        });
      });
      $scope.recording = false;
    }
  }

  $scope.showListBottomSheet = function($event) {
    $scope.alert = '';
    $mdBottomSheet.show({
      templateUrl: 'bottom-sheet-list-template.html',
      controller: 'ListBottomSheetCtrl',
      targetEvent: $event
    }).then(function(clickedItem) {
      if(clickedItem !== 'no device') {
        console.log(clickedItem + ' clicked!');
        $scope.targetDevice = clickedItem;
      }
    });
  };

}])
.controller('ListBottomSheetCtrl', function($scope, $mdBottomSheet) {

  $scope.items = [];

  client.listDevices()
  .map(function(device) { $scope.items.push(device); });

  $scope.listItemClick = function($index) {
    var clickedItem = $scope.items[$index].id;
    $mdBottomSheet.hide(clickedItem);
  };

  $scope.hide = function() {
    $mdBottomSheet.hide('no device');
  };

  $scope.isNoDevice = function() {
    return $scope.items.length === 0;
  }

});

angular.element(document).ready(function() {
  angular.bootstrap(document, ['snapperApp']);
});

function stopAndPull(serial, cb) {
  client.listDevices()
  .filter(function(device) { return isTargetDevice(device, serial) })
  .get(0)
  .then(function(device) { return client.shell(device.id, "ps  | grep screenrecord | awk '{print $2}'") })
  //.then(streamToPromise)
  .then(adb.util.readAll)
  .then(function(output) {
    run(serial, 'kill -2 ' + output.toString().trim());
    // TODO
    setTimeout(function (){
      pull(serial, '/sdcard/tmp.mp4', cb);
    }, 200);
  })
  .catch(function(err) {
    console.error('Something went wrong:' + err.message);
    cb(err.message);
  });
}

function screencap(serial, cb) {
  mkdirIfNotExist('./snapperFiles/', 0744, function(err) {
    if(err) {
      console.log("Can't create a directory.");
      cb("Can't create a directory.");
    } else {
      var fileName = moment().format('[screencapture-]MMDDYY-hhmmss[.png]');
      client.screencap(serial)
      .then(function(pngStream) {
        var outfile = fs.createWriteStream('./snapperFiles/' + fileName);
        var png = StreamPng(pngStream);
        png.out().pipe(outfile);
      })
      .then(function() {
        console.log('Done!');
        cb(null);
      })
      .catch(function(err) {
        console.error('Something went wrong: ' + err.message);
        cb(err.message);
      })
    }
  });
}

function pull(serial, path, cb) {
  client.listDevices()
  .filter(function(device) { return isTargetDevice(device, serial) })
  .get(0)
  .then(function(device) {
    if(typeof device != 'undefined') {
      mkdirIfNotExist('./snapperFiles', 0744, function(err) {
        if (err) {
          console.log("Can't create a directory.");
        } else {
          var fileName = moment().format('[screenrecord-]MMDDYY-hhmmss[.mp4]');
          client.pull(serial, path)
          .then(function(transfer) {
            return new Promise(function(resolve, reject) {
              var fn = './snapperFiles/' + fileName;
              transfer.on('progress', function(stats) {
                console.log(stats.bytesTransferred + ' bytes so far')
              })
              transfer.on('end', function() {
                console.log('Pull complete')
                resolve(serial)
              })
              transfer.on('error', reject)
              transfer.pipe(fs.createWriteStream(fn))
            })
          })
          .then(function(serial) {
            setTimeout(function () {
              run(serial, 'rm -f ' + path);
              cb(null);
            }, 1000);
          });
        }
      });
    }
  });
}

function screenrecord(serial) {
  run(serial, "screenrecord /sdcard/tmp.mp4")
}

function run(serial, script) {
  return client.listDevices()
  .filter(function(device) { return isTargetDevice(device, serial) })
  .get(0)
  .then(function(device) { return client.shell(device.id, script) })
  //.then(streamToPromise)
  .then(adb.util.readAll)
  .then(function(output) { console.log(output.toString().trim()) })
  .catch(function(err) { console.error('Something went wrong:' + err.message) })
}

function streamToPromise(stream) {
  return new Promise(function(resolve, reject) {
    stream.on('data', function(chunk) { console.log(chunk.toString().trim()); });
    stream.on("end", resolve);
    stream.on("error", reject);
  });
}

function isTargetDevice(device, serial) {
  return device.id === serial
}

function mkdirIfNotExist(path, mask, cb) {
  if (typeof mask == 'function') {
    cb = mask;
    mask = 0777;
  }
  fs.mkdir(path, mask, function(err) {
    if (err) {
      if (err.code == 'EEXIST') cb(null);
      else cb(err);
    } else cb(null);
  });
}
