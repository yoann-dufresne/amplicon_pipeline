const exec = require('child_process').spawn;
const fs = require('fs');


exports.name = 'pandaseq';

exports.run = function (token, config, callback) {
	console.log("Running pandaseq with the command line:");
	console.log('/app/lib/pandaseq/pandaseq ' +
		' -f /app/data/' + token + '/' + config.params.inputs.fwd +
		' -r /app/data/' + token + '/' + config.params.inputs.rev +
		' -w /app/data/' + token + '/' + config.params.outputs.assembly);

	var child = exec('/app/lib/pandaseq/pandaseq',
		['-f', '/app/data/' + token + '/' + config.params.inputs.fwd,
		'-r', '/app/data/' + token + '/' + config.params.inputs.rev,
		'-w', '/app/data/' + token + '/' + config.params.outputs.assembly]);


	child.stdout.on('data', function(data) {
		fs.appendFileSync('/app/data/' + token + '/' + config.log, data);
	});
	child.stderr.on('data', function(data) {
		fs.appendFileSync('/app/data/' + token + '/' + config.log, data);
	});
	child.on('close', function(code) {
		if (code == 0)
			callback(token, null);
		else
			callback(token, "pandaseq terminate on code " + code);
	});
};