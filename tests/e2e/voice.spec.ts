import {chromium,type Page} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {VOICE_STATUS} from '@bluff-house/shared';
import {test,expect,readyAndStart} from '../fixtures/browser.js';
import {TRIAL_ORIGIN,prepareVoiceTrial,connectTrials,audioStats,trialState} from '../fixtures/voice-trial.js';

test('unavailable production voice never captures, records or opens a peer during room entry and gameplay',async({table,browser})=>{
  const pages:Page[]=[];
  for(let i=0;i<2;i++){
    const context=await browser.newContext();table.contexts.push(context);
    await context.addInitScript(()=>{
      const counters={capture:0,peers:0,recorders:0};Object.defineProperty(window,'productionMediaCalls',{value:counters});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{counters.capture++;throw new Error('Production voice is unavailable');};
      if(window.RTCPeerConnection)window.RTCPeerConnection=new Proxy(window.RTCPeerConnection,{construct(){counters.peers++;throw new Error('Production peer creation is unavailable');}});
      if(window.MediaRecorder)window.MediaRecorder=new Proxy(window.MediaRecorder,{construct(){counters.recorders++;throw new Error('Recording is unavailable');}});
    });
    const page=await context.newPage();await page.goto(table.url);pages.push(page);
  }
  await pages[0].getByRole('button',{name:/How to play/i}).click();await expect(pages[0].getByLabel('Room voice status')).toHaveText(VOICE_STATUS.message);await expect(pages[0].getByRole('button',{name:/join audio|enable microphone|enable voice/i})).toHaveCount(0);await pages[0].getByRole('button',{name:"I'm in",exact:true}).click();
  const code=await table.host(pages[0]);await table.join(pages[1],code,'Blair');await readyAndStart(pages);for(const page of pages)await page.getByRole('button',{name:'Place Bet',exact:false}).click();table.advance(21000);await expect(pages[0].getByRole('button',{name:'Hit',exact:true})).toBeEnabled();await pages[0].getByRole('button',{name:'Stand',exact:true}).click();
  for(const page of pages){expect(await page.evaluate(()=>Reflect.get(window,'productionMediaCalls'))).toEqual({capture:0,peers:0,recorders:0});await expect(page.getByRole('button',{name:/join audio|enable microphone|enable voice/i})).toHaveCount(0);}
});

test('test-only synthetic WebAudio establishes bidirectional host ICE RTP, supports mute and repeat leave cleanup without external ICE services',async()=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});
  try{
    const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage()));
    for(const page of pages){await prepareVoiceTrial(page,'synthetic');expect(await page.evaluate(()=>isSecureContext)).toBe(true);expect(await trialState(page)).toMatchObject({calls:0,captureCalls:0,connectionState:null,tracks:[]});await page.getByRole('button',{name:'Join fake audio'}).click();await expect(page.locator('#state')).toHaveText('Ready');}
    await connectTrials(pages[0],pages[1]);await expect.poll(async()=>Promise.all(pages.map(async p=>(await audioStats(p)).connectionState)),{timeout:15000}).toEqual(['connected','connected']);
    await expect.poll(async()=>Promise.all(pages.map(async p=>(await audioStats(p)).receivedPackets>0)),{timeout:15000}).toEqual([true,true]);
    await expect.poll(async()=>Promise.all(pages.map(async p=>(await audioStats(p)).selectedStates.includes('succeeded'))),{timeout:15000}).toEqual([true,true]);
    const first=await Promise.all(pages.map(audioStats));for(const stats of first){expect(stats.receivedBytes).toBeGreaterThan(0);expect(stats.sentPackets).toBeGreaterThan(0);expect(stats.candidateTypes).toEqual(['host']);expect(stats.selectedStates).toContain('succeeded');expect(stats.iceServers).toEqual([]);}
    await pages[0].getByRole('button',{name:'Mute',exact:true}).click();expect((await trialState(pages[0])).tracks).toEqual([{enabled:false,readyState:'live',kind:'audio'}]);
    for(const page of pages){await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('#state')).toHaveText('Off');const state=await trialState(page);expect(state.connectionState).toBe('closed');expect(state.audioContextState).toBe('closed');expect(state.oscillatorStopped).toBe(true);expect(state.captureCalls).toBe(0);expect(state.tracks.every(t=>t.readyState==='ended')).toBe(true);expect(state.remoteTracks.every(t=>t.readyState==='ended')).toBe(true);}
    for(const page of pages){await page.getByRole('button',{name:'Join fake audio'}).click();await expect(page.locator('#state')).toHaveText('Ready');expect((await trialState(page)).calls).toBe(2);}
    await connectTrials(pages[0],pages[1]);await expect.poll(async()=>Promise.all(pages.map(async p=>(await audioStats(p)).receivedPackets>0)),{timeout:15000}).toEqual([true,true]);const repeated=await Promise.all(pages.map(audioStats));
    for(const page of pages){await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('#state')).toHaveText('Off');const state=await trialState(page);expect(state.tracks.every(t=>t.readyState==='ended')).toBe(true);expect(state.remoteTracks.every(t=>t.readyState==='ended')).toBe(true);expect(state.connectionState).toBe('closed');expect(state.audioContextState).toBe('closed');expect(state.oscillatorStopped).toBe(true);expect(state.captureCalls).toBe(0);}
    const output=test.info().outputPath('local-audio-feasibility.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({scope:'one computer; two independent Chromium contexts; SYNTHETIC WebAudio oscillator, no microphone capture; test-harness SDP exchange only',browser:browser.version(),iceServers:[],first,repeated,muteTrackDisabled:true,leaveTracksEnded:true,audioSourcesClosed:true,captureCalls:0,recording:false,physicalTwoDeviceTrial:false,intelligibilityVerified:false,internetNatTraversalVerified:false},null,2));
  }finally{await browser.close();}
});

test('test-only explicit fake capture records scoped permission state and the actual runtime capability',async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--mute-audio']});
  try{const probes=[];
    for(const permission of ['denied','granted'] as const){const context=await browser.newContext(),page=await context.newPage();await prepareVoiceTrial(page);await context.grantPermissions(permission==='granted'?['microphone']:[],{origin:TRIAL_ORIGIN});expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'microphone' as PermissionName})).state)).toBe(permission);expect((await trialState(page)).captureCalls).toBe(0);await page.getByRole('button',{name:'Join fake audio'}).click();await expect.poll(async()=>{const state=await trialState(page);return state.error??state.connectionState;}).not.toBeNull();const state=await trialState(page);expect(state.captureCalls).toBe(1);
      if(permission==='denied'||state.error){expect(state.error).not.toBeNull();expect(['NotAllowedError','NotSupportedError','NotFoundError','NotReadableError']).toContain(state.error);expect(state.connectionState).toBeNull();expect(state.tracks).toEqual([]);}else{expect(state.tracks).toHaveLength(1);await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('#state')).toHaveText('Off');expect((await trialState(page)).tracks.every(t=>t.readyState==='ended')).toBe(true);}
      probes.push({permission,...state});await context.close();
    }
    const output=test.info().outputPath('capture-permission-capability.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({browser:browser.version(),scope:'test-only fake capture with scoped Playwright permissions; no fake UI; actual errors preserved, no claim of permission denial enforcement when capture is unsupported',probes,recording:false},null,2));
  }finally{await browser.close();}
});
