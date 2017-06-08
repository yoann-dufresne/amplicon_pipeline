
const fs = require('fs');
const sub_process = require('./sub_process.js');


var waiting_jobs = [];
var running_jobs = {};

const MAX_JOBS = 1;

exports.start = function () {
	setInterval (scheduler, 10000);
};

var scheduler = function () {
	// Add a new job if not so busy
	if (Object.keys(running_jobs).length < MAX_JOBS && waiting_jobs.length > 0) {
		var token = waiting_jobs.shift();
		fs.readFile ('/app/data/' + token + '/exec.log', (err, data) => {
			if (err) throw err;
			
			// Load the configuration file.
			running_jobs[token] = JSON.parse(data);
		});
	}
	
	// Update the software executions
	for (var token in running_jobs) {
		var job = running_jobs[token];
		if (job.status == "ready") {
			// Verify if ended
			if (job.order == null || job.order.length == 0) {
				job.status = 'ended';
				fs.writeFile('/app/data/' + token + '/exec.log', JSON.stringify(job), (err) => {});
				console.log(token + ': Ended');

				// Mayby problematic: TODO : verify with multiple jobs
				delete running_jobs[token];
				continue;
			}

			// Lanch the next software for the current job
			var nextId = job.order.shift();

			// Update the software status
			job.status = "running";
			job.running_soft = nextId;

			// Define output log files and status for all the sub-jobs in the current job
			// Sub-jobs are input/output variations on the same software
			var configs_array = job.conf[nextId];
			for (var sub_idx=0 ; sub_idx<configs_array.length ; sub_idx++) {
				configs_array[sub_idx].status = "waiting";
				configs_array[sub_idx].log = 'out_' + nextId + '_' + sub_idx + '.log';
			}
			job.conf[nextId] = configs_array;

			// Save the status
			running_jobs[token] = job;
			fs.writeFileSync('/app/data/' + token + '/exec.log', JSON.stringify(job));
			console.log (token + ': status updated');

			// Start the sub-process
			sub_process_start(token, configs_array);
		}
	}
};


var sub_process_start = (token, configs_array) => {
	let job = running_jobs[token];
	let sub_idx = job.sub_running_job ? job.sub_running_job : 0;
	job.sub_running_job = sub_idx;

	let current_params = configs_array[sub_idx];
	job.conf[job.running_soft][sub_idx].status = 'running';
	fs.writeFileSync('/app/data/' + token + '/exec.log', JSON.stringify(job));

	sub_process.run(token, current_params, (token, err) => {
		let job = running_jobs[token];

		// Abord the pipeline if an error occur.
		if (err) {
			job.status = 'aborted';
			job.msg = err;
			fs.writeFile('/app/data/' + token + '/exec.log', JSON.stringify(job), (err) => {});
			delete running_jobs[token];

			console.log(token + ': aborted');
			return;
		}

		// Add software output to the log file and modify the status.
		job.conf[job.running_soft][sub_idx].status = "ended";
		job.sub_running_job += 1;

		// Save the status
		running_jobs[token] = job;
		fs.writeFileSync('/app/data/' + token + '/exec.log', JSON.stringify(job));

		// recursively call sub_process_start
		if (job.sub_running_job < configs_array.length) {
			sub_process_start (token, configs_array);
		} else {// Stop the job
			job.status = 'ready';

			// Compact output if needed
			if (job.conf[job.running_soft][0].out_jokers) {
				sub_process.compress_outputs(token, job.conf[job.running_soft][0].out_jokers);
			}
			
			delete job.running_soft;
			delete job.sub_running_job;
		}
	});
};



// ----- Job submitions -----


exports.listen_commands = function (app) {
	app.post('/run', function (req, res) {
		var params = req.body;

		// Token verifications
		if (params.token == undefined) {
			res.status(403).send('No token present in the request')
			return;
		}

		var token = params.token;
		delete params.token;

		// Verification of the existance of the token
		if (! fs.existsSync('/app/data/' + token)){
			res.status(403).send('Invalid token')
			return;
		}

		// Save the conf and return message
		fs.writeFile('/app/data/' + token + '/pipeline.conf', JSON.stringify(params), (err) => {
			if (err) throw err;
			console.log(token + ': configuration saved!');
		});
		res.send('Pipeline started');

		// Create the execution log file
		var logFile = '/app/data/' + token + '/exec.log';
		
		for (var idx in params) {
			params[idx].status = "waiting";
		}
		var exe = {
			status: "waiting",
			conf: params,
			order: null
		};
		fs.writeFileSync(logFile, JSON.stringify(exe));

		// Schedule the softwares
		var order = computeSoftwareOrder(params, token);
		// Modify the the parameters if there are joken tokens in the inputs
		let files = getAllFiles(params, token);
		exe.conf = expand_parameters (params, files, order);

		// If dependencies are not satisfied
		if (order.length < Object.keys(exe.conf).length) {
			exe.status = 'aborted';
			exe.msg = "dependencies not satisfied";

			fs.writeFile(logFile, JSON.stringify(exe), function (err) {if (err) console.log(err)});
			return;
		}

		exe.status = 'ready';
		exe.order = order;
		fs.writeFile(logFile, JSON.stringify(exe), function (err) {if (err) console.log(err)});

		waiting_jobs.push(token);
	});
}

exports.expose_status = function (app) {
	app.get('/status', function (req, res) {
		// If no token, send back a general status
		if (req.query.token == undefined) {
			res.send(JSON.stringify({queue_size: waiting_jobs.length}));
			return ;
		}

		var token = req.query.token;
		var execFile = '/app/data/' + token + '/exec.log';
		// Invalid token
		if (!fs.existsSync(execFile)) {
			res.status(403).send('Invalid token');
			return ;
		}

		// Send back execution status
		fs.readFile(execFile, (err, data) => {
			var exec = JSON.parse(data);
			var status = {global:exec.status, jobs:{}};

			if (status.global == 'aborted')
				status.msg = exec.msg;

			// Browse process
			for (var idx in exec.conf) {
				sub_status = {};
				// Analyse the sub process results
				for (var sub_idx=0 ; sub_idx<exec.conf[idx].length ; sub_idx++) {
					let st = exec.conf[idx][sub_idx].status;
					sub_status[st] = sub_status[st] ? sub_status[st] + 1 : 1;
				}

				// Write
				switch (Object.keys(sub_status).length ) {
				case 0:
					status.jobs[idx] = 'ready';
					break;
				case 1:
					status.jobs[idx] = Object.keys(sub_status)[0];
					break;
				default:
					// If aborted
					if (sub_status['aborted']) {
						status.jobs[idx] = 'aborted';
						break;
					}

					// If it's running
					var total = 0;
					for (var key in sub_status) {
						total += sub_status[key];
					}

					status.jobs[idx] = 'running';
					status.sub_jobs = total;
					status.sub_ended = sub_status['ended'] ? sub_status['ended'] : 0;
				}
			}

			res.send(JSON.stringify(status));
		});
	});
}


var computeSoftwareOrder = function (params, token) {
	// Compute the dependenciess
	dependencies = {};
	for (var key in params) {
		var soft = params[key];

		// Unique identifier for an execution (Needed if the are multiple executions
		// of the same tool in one run).
		soft.params.id = key;

		// look for dependencies
		for (var id in soft.params.inputs) {
			var file = soft.params.inputs[id];
			if (dependencies[file] == undefined)
				dependencies[file] = [];
			dependencies[file].push(key);
		}
	}


	// Compute the order from the dependencies
	var order = [];
	var filesAvailable = [];

	// Add to the available files all the uploads
	var filenames = fs.readdirSync('/app/data/' + token);
	for (var idx in filenames) {
		filesAvailable.push(filenames[idx]);
	}

	// DFS on files
	while (filesAvailable.length > 0) {
		var filename = filesAvailable.shift();

		if (dependencies[filename] == undefined)
			continue;

		var dep = dependencies[filename];
		delete dependencies[filename];

		// Will look for each soft if it can be executed
		for (var soft_id in dep) {
			soft_id = dep[soft_id];

			var soft = params[soft_id];

			// Look if each dependencie is satisfied
			var isExecutable = true;
			for (var id in soft.params.inputs) {
				var file = soft.params.inputs[id];
				if (dependencies[file] != undefined) {
					isExecutable = false;
					break;
				}
			}

			// Add the software in the queue if it's not already present
			if (isExecutable && order.indexOf(soft_id) == -1) {
				order.push(soft_id);
				for (var id in soft.params.outputs) {
					var file = soft.params.outputs[id];
					filesAvailable.push(file);
				}
			}
		}
	}

	return order;
}


var expand_parameters = (params, no_joker_files, order) => {
	for (var idx=0 ; idx<order.length ; idx++) {
		var soft_id = order[idx];

		var inputs = params[soft_id].params.inputs;
		var outputs = params[soft_id].params.outputs;

		// Store all the files for a common joker subpart
		var configurations = {};

		// Explore all the inputs
		for (var in_id in inputs) {
			var filename = inputs[in_id];

			// Save for 
			if (filename.includes('*')) {
				let begin = filename.substring(0, filename.indexOf('*'));
				let end = filename.substring(filename.indexOf('*')+1);

				// Look for corresponding files
				for (var idx=0 ; idx<no_joker_files.length ; idx++) {
					var candidate = no_joker_files[idx];

					if (candidate.includes('*'))
						continue;

					// If the file correspond, extract the core text
					if (candidate.startsWith(begin) && candidate.endsWith(end)) {
						var core = candidate.substring(begin.length);
						core = core.substring(0, core.indexOf(end));

						// Get the config
						var config = configurations[core] ? configurations[core] :
							JSON.parse(JSON.stringify(params[soft_id]));
						// Update the config
						config.params.inputs[in_id] = candidate;
						configurations[core] = config;
					}
				}
			}
		}


		// Explore all the outputs
		var out_jokers = {};
		for (var out_id in outputs) {
			let filename = outputs[out_id];
			if (filename.includes('*')) {
				out_jokers[out_id] = filename;
			}
		}


		var conf_array = [];
		// Update outputs if * in input
		for (id in configurations) {
			let config = configurations[id];
			for (out_id in config.params.outputs) {
				let filename = config.params.outputs[out_id];

				if (filename.includes('*')) {
					// Replace the * by the complete name
					config.params.outputs[out_id] = filename.replace('\*', id);
				}
			}
			if (Object.keys(out_jokers).length > 0)
				config.out_jokers = out_jokers;

			conf_array.push(config);
		}
		// Update if no joker
		if (conf_array.length == 0) {
			conf_array.push(params[soft_id]);
			if (Object.keys(out_jokers).length > 0)
				conf_array[0].out_jokers = out_jokers;
		}

		params[soft_id] = conf_array;
	}

	return params;
};


var getAllFiles = (params, token) => {
	// Get Uploaded files
	var filenames = fs.readdirSync('/app/data/' + token);

	// Get the files that will be created
	for (var soft_id in params) {
		var outputs = params[soft_id].params.outputs;

		for (var out_id in outputs) {
			let filename = outputs[out_id];
			if ((!filename.includes('*')) && filenames.indexOf(filename) == -1)
				filenames.push(filename);
		}
	}

	return filenames
};