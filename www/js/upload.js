
var up_formData;
var up_filenames = [];
document.querySelector("#up_files").onchange = function (event) {
	var files = event.target.files;
	up_filenames = [];
	
	if (files.length > 0){
		// One or more files selected, process the file upload

		// create a FormData object which will be sent as the data payload in the
		// AJAX request
		up_formData = new FormData();
		up_formData.append('token', exec_token);

		// loop through all the selected files
		for (var i = 0; i < files.length; i++) {
		  var file = files[i];

		  // add the files to up_formData object for the data payload
		  up_formData.append('uploads[]', file, file.name);
		  up_filenames.push(file.name);
		}

	  }

}


document.querySelector("#up_submit").onclick = function (event) {
	// Stop stuff happening
	event.stopPropagation();
	event.preventDefault();

	// Read the file content if it's a CSV and store it on the client side
	var file_selector = document.getElementById('up_files');
	for (var idx=0 ; idx<file_selector.files.length ; idx++) {
		var file = file_selector.files[idx];

		// If CSV
		if (file.name.endsWith(".csv")) {
			// Read the file
			var reader = new FileReader();
			reader.filename = file.name;
			reader.onload = (e) => {
				// Parse the file content
				var csv_txt = e.target.result;
				var data = Papa.parse(csv_txt, {header: true});

				// Save the content
				file_manager.contents[e.target.filename] = data;
			};
			reader.readAsText(file);
		}
	}

	// Upload the file
	$.ajax({
		url: '/upload',
		type: 'POST',
		data: up_formData,
		cache:false,
		processData: false, // Don't process the files
		contentType: false, // Set content type to false as jQuery will tell the server its a query string request
		
		success: function(data, textStatus, jqXHR)
		{
			if(typeof data.error === 'undefined') {
				var event = new Event('new_file');
				event.files = up_filenames;
				document.dispatchEvent(event);
			} else {
				// Handle errors here
				console.log('ERRORS: ' + data.error);
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Handle errors here
			console.log('ERRORS: ' + textStatus);
			// STOP LOADING SPINNER
		},
		xhr: function() {
			// create an XMLHttpRequest
			var xhr = new XMLHttpRequest();

			// listen to the 'progress' event
			xhr.upload.addEventListener('progress', function(evt) {

				if (evt.lengthComputable) {
					// calculate the percentage of upload completed
					var percentComplete = evt.loaded / evt.total;
					percentComplete = parseInt(percentComplete * 100);

					// update the Bootstrap progress bar with the new percentage
					$('.progress-bar').text(percentComplete + '%');
					$('.progress-bar').width(percentComplete + '%');

					// once the upload reaches 100%, set the progress bar text to done
					if (percentComplete === 100) {
						$('.progress-bar').html('Done');
					}
				}

			}, false);

			return xhr;
		}
	});
}



// Print the file list
file_manager.register_observer((manager) => {
	var up_list = document.querySelector("#up_list");
	up_list.innerHTML = '';

	var filenames = manager.server_files;
	if (filenames.length > 0) {
			up_list.innerHTML = '<p>Server files</p>';
			var ul = document.createElement("ul");
			
			for (var idx in filenames) {
				var filename = filenames[idx];

				var li = document.createElement("li");
				li.innerHTML = '<a href="/data/' + exec_token + '/' + filename + '" download>\
				<img src="/imgs/download.png" class="download"/></a>  ' + filename;
				ul.appendChild(li);
			}
			up_list.appendChild(ul);
		}
});
