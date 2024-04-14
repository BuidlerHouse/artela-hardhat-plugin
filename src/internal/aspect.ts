import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const Web3 = require("@artela/web3");
const ARTELA_ADDR = "0x0000000000000000000000000000000000A27E14";
const ASPECT_ADDR = "0x0000000000000000000000000000000000A27E14";

function getArtelaConfig(): { nodeUrl: string; privateKey: string } {
  const baseDir = process.cwd();
  const configPath = path.join(baseDir, 'hardhat.config.js');
  if (!fs.existsSync(configPath)) {
    console.log("hardhat.config.js does not exist. Please create it.");
    process.exit(0);
  }
  const config = require(configPath);
  const nodeUrl = config.networks.artela?.url;
  if (!nodeUrl) {
    console.log("Artela Node URL is not configured in hardhat.config.js. Please set it.");
    process.exit(0);
  }
  const accounts = config.networks.artela.accounts;
  if (!accounts) {
    console.log("Artela accounts are not configured in hardhat.config.js. Please set them.");
    process.exit(0);
  }
  const privateKey = accounts[0];

  return { nodeUrl, privateKey };
}

/**
 * Compiles an AssemblyScript file.
 * 
 * @param {string} entryFile The path to the source file.
 * @param {string} target The compilation target: 'debug' or 'release'.
 * @param {string} output The path to the output file.
 */
export function compileAspect(entryFile = "aspect/index.ts", target = "debug", output: string | null) {
  const filename = path.basename(entryFile, path.extname(entryFile));
  if (!output) {
    if (target === 'release') {
      output = `build/${filename}.wasm`;
    } else { 
      output = `build/${filename}_debug.wasm`;
    }
  }
  
// Check if the build directory exists, if not, create it
const buildDir = path.dirname(output);
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const command = 'npx';
const args = ['asc', entryFile, '--target', target, '-o', output];

console.log(`Running command: ${command} ${args.join(' ')}`);
  const childProcess = spawn(command, args);
  childProcess.stdout.on('data', (data) => {
    console.log('stdout event triggered.');
    console.log(`stdout: ${data}`);
  });

  childProcess.stderr.on('data', (data) => {
    console.log('stderr event triggered.');
    console.error(`stderr: ${data}`);
  });

  childProcess.on('close', (code) => {
    console.log('close event triggered.');
    if (code !== 0) {
      console.error(`Failed to compile AssemblyScript: process exited with code ${code}`);
      process.exit(code);
    } else {
      console.log("AssemblyScript compilation completed successfully.");
    }
  });
}

export async function deployAspect(
  properties: string | null, joinPoints: Array<string> | null, wasmPath: string, gas: string
) {
  // TODO: gas nullable for default value
  const { nodeUrl, privateKey } = getArtelaConfig();
  const web3 = new Web3(nodeUrl);
  let gasPrice = await web3.eth.getGasPrice();
  let sender = web3.eth.accounts.privateKeyToAccount(privateKey.trim());
  console.log("from address: ", sender.address);
  web3.eth.accounts.wallet.add(sender.privateKey);
  let propertiesArr = properties ? JSON.parse(properties) : [];
  let joinPointsArr = joinPoints || [];
  const validJoinPoints = ['preContractCall', 'postContractCall', 'preTxExecute', 'postTxExecute', 'verifyTx'];
  for (const joinPoint of joinPointsArr) {
    if (!validJoinPoints.includes(joinPoint)) {
      console.log(`Invalid join point: ${joinPoint}`);
      process.exit(0);
    }
  }
  //read wasm code
  let aspectCode = "";
  aspectCode = fs.readFileSync(wasmPath, {encoding: "hex"});
  if (!aspectCode || aspectCode === "") {
    console.log("aspectCode cannot be empty")
    process.exit(0)
  }
  // to deploy aspect
  let aspect = new web3.atl.Aspect();
  let deploy = await aspect.deploy({
    data: '0x' + aspectCode,
    properties: propertiesArr,
    joinPoints: joinPointsArr,
    paymaster: sender.address,
    proof: '0x0',
  });

  let tx = {
    from: sender.address,
    data: deploy.encodeABI(),
    to: ARTELA_ADDR,
    gasPrice,
    gas: parseInt(gas) || 9000000
  }
  let signedTx = await web3.atl.accounts.signTransaction(tx, sender.privateKey);
  console.log("sending signed transaction...");
  let ret = await web3.atl.sendSignedTransaction(signedTx.rawTransaction)
    .on('receipt', (receipt: any) => {
      console.log(receipt);
    });
  let aspectID = ret.aspectAddress;
  console.log("ret: ", ret);
  // TODO: save aspectID locally
  // TODO: add explorer view
  // TODO: support explorer verify
  // https://betanet-scan.artela.network/tx/0x8c56c4903fd039a5c54f1b0e8111d5b5d6ba745fe7aec78961b31809c637206f
  console.log("== deploy aspectID ==", aspectID)
  return aspectID;
}

export async function bindAspect(contractAddress: string, aspectId: string, gas: string) {
  // TODO: gas nullable for default value
  const { nodeUrl, privateKey } = getArtelaConfig();
  const web3 = new Web3(nodeUrl);
  let gasPrice = await web3.eth.getGasPrice();
  let sender = web3.eth.accounts.privateKeyToAccount(privateKey.trim());
  web3.eth.accounts.wallet.add(sender.privateKey);
  let storageInstance = new web3.eth.Contract([], contractAddress);
  let bind = await storageInstance.bind({
      priority: 1,
      aspectId: aspectId,
      aspectVersion: 1,
  })
  let tx = {
      from: sender.address,
      data: bind.encodeABI(),
      gasPrice,
      to: ASPECT_ADDR,
      gas: parseInt(gas) || 9000000
  }
  let signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);
  console.log("sending signed transaction...");
  await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
      .on('receipt', (receipt: any) => {
          console.log(receipt);
      });
  console.log("== aspect bind success ==");
}

export async function unbindAspect(contractAddress: string, aspectId: string, gas: string) {
  // TODO: gas nullable for default value
  const { nodeUrl, privateKey } = getArtelaConfig();
  const web3 = new Web3(nodeUrl);
  let gasPrice = await web3.eth.getGasPrice();
  let sender = web3.eth.accounts.privateKeyToAccount(privateKey.trim());
  web3.eth.accounts.wallet.add(sender.privateKey);
  const aspectContract = new web3.atl.aspectCore();
    // bind the smart contract with aspect
    const unbind = await aspectContract.methods.unbind(
        aspectId,
        contractAddress
    )
    const tx = {
        from: sender.address,
        data: unbind.encodeABI(),
        gasPrice,
        to: aspectContract.options.address,
        gas: parseInt(gas) || 9000000
      }
    const signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);
    await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
        .on('receipt', (receipt: any) => {
            console.log(receipt);
        });
    console.log("== aspect unbind success ==");
}