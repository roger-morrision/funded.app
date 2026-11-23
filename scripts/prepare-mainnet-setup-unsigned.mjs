#!/usr/bin/env node
// Public-input-only offline report. No RPC, secret files, signing or submission.
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {buildMainnetSetupInventory} from './mainnet-setup-unsigned.mjs';

const {values}=parseArgs({options:{plan:{type:'string',default:'config/mainnet-deployment-plan.json'},
  inputs:{type:'string'}}});
const plan=JSON.parse(readFileSync(values.plan,'utf8'));
const inputs=values.inputs?JSON.parse(readFileSync(values.inputs,'utf8')):{};
if(inputs===null||typeof inputs!=='object'||Array.isArray(inputs)
  ||Object.keys(inputs).some(key=>!['dailyCapLamports','feePayers','recentBlockhash'].includes(key)))
  throw Error('Inputs may contain only dailyCapLamports, feePayers and recentBlockhash.');
console.log(JSON.stringify(buildMainnetSetupInventory({plan,...inputs}),null,2));
