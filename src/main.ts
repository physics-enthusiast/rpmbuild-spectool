const core = require('@actions/core');
const exec = require('@actions/exec');
const io = require('@actions/io');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require("os");

async function run() {
  try {
    // get inputs from workflow
    // specFile name
    const configPath = core.getInput('spec_file'); // user input, eg: `foo.spec' or `rpm/foo.spec'
    const target = core.getInput('target');
    const basename = path.basename(configPath); // always just `foo.spec`
    const userHomeDir = os.homedir();
    const buildpath = `${userHomeDir}/rpmbuild`
    const specFile = {
      srcFullPath: `/github/workspace/${configPath}`,
      destFullPath: `${buildpath}/SPECS/${basename}`,
    };

    // Read spec file and get values 
    var data = fs.readFileSync(specFile.srcFullPath, 'utf8');
    let name = '';       
    let version = '';

    for (var line of data.split('\n')){
        var lineArray = line.split(/[ ]+/);
        if(lineArray[0].includes('Name')){
            name = name+lineArray[1];
        }
        if(lineArray[0].includes('Version')){
            version = version+lineArray[1];
        }   
    }
    console.log(`name: ${name}`);
    console.log(`version: ${version}`);

    // setup rpm tree
    await exec.exec('rpmdev-setuptree');

    // Copy spec file from path specFile to the build directory
    await exec.exec(`cp ${specFile.srcFullPath} ${specFile.destFullPath}`);

    // Autodownload sources
    await exec.exec(`spectool -g -R ${specFile.destFullPath}`);

    let repoString = '';
    // Installs additional repositories
    const additionalRepos = core.getInput('additional_repos'); // user input, eg: '["centos-release-scl"]'
	if (additionalRepos) {
		const arr = JSON.parse(additionalRepos);
		for (let i = 0; i < arr.length; i++) {
			console.log(`Installing repo': ${arr[i]}`);
    		        repoString = repoString +`--addrepo=${arr[i]} `;
		};
	}
    repoString = repoString.trim()

    // Generate SPRM
    try {
      await exec.exec(
        `mock buildsrpm -r ${target} --spec=${specFile.destFullPath} --sources=${buildpath}/SOURCES/ --resultdir=${buildpath}/SRPMS/ ${repoString}`
      );
    } catch (err) {
      core.setFailed(`action failed with error: ${err}`);
    }

    // Verify SRPM is created
    await exec.exec(`ls ${buildpath}/SRPMS`);

    // Get source rpm name , to provide file name, path as output
    let srpmOutput = '';
    await cp.exec(`ls ${buildpath}/SRPMS/*.src.rpm`, (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        console.error(err)
      } else {
          // the *entire* stdout and stderr (bffered)
          console.log(`stdout: ${stdout}`);
          srpmOutput = srpmOutput+`${stdout}`.trim();
          console.log(`stderr: ${stderr}`);
        }
      });

    // Generate PRM
    try {
      await exec.exec(
        `mock rebuild ${buildpath}/SRPMS/${srpmOutput} -r ${target} --resultdir=${buildpath}/RPMS/ ${repoString}`
      );
    } catch (err) {
      core.setFailed(`action failed with error: ${err}`);
    }
	  
    // Verify RPM is created
    await exec.exec(`ls ${buildpath}/RPMS`);

    // Get rpm name , to provide file name, path as output
    let rpmOutput = '';
    await cp.exec(`ls ${buildpath}/RPMS/*.rpm`, (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        console.error(err)
      } else {
          // the *entire* stdout and stderr (bffered)
          console.log(`stdout: ${stdout}`);
          rpmOutput = rpmOutput+`${stdout}`.trim();
          console.log(`stderr: ${stderr}`);
        }
      });
	  
    // only contents of workspace can be changed by actions and used by subsequent actions 
    // So copy all generated rpms into workspace , and publish output path relative to workspace (/github/workspace)
    await exec.exec(`mkdir -p rpmbuild/SRPMS`);
    await exec.exec(`mkdir -p rpmbuild/RPMS`);

    await exec.exec(`cp ${buildpath}/SRPMS/${srpmOutput} rpmbuild/SRPMS`);
    await cp.exec(`cp -R ${buildpath}/RPMS/. rpmbuild/RPMS/`);

    await exec.exec(`ls -la rpmbuild/SRPMS`);
    await exec.exec(`ls -la rpmbuild/RPMS`);
    
    // set outputs to path relative to workspace ex ./rpmbuild/
    core.setOutput("source_rpm_dir_path", `rpmbuild/SRPMS/`);              // path to  SRPMS directory
    core.setOutput("source_rpm_path", `rpmbuild/SRPMS/${srpmOutput}`);       // path to Source RPM file
    core.setOutput("source_rpm_name", `${srpmOutput}`);                      // name of Source RPM file
    core.setOutput("rpm_dir_path", `rpmbuild/RPMS/`);                      // path to RPMS directory
    core.setOutput("rpm_path", `rpmbuild/RPMS/${rpmOutput}`);       // path to RPM file
    core.setOutput("rpm_name", `${rpmOutput}`);                      // name of RPM file
    core.setOutput("rpm_content_type", "application/octet-stream");        // Content-type for Upload
    


  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
