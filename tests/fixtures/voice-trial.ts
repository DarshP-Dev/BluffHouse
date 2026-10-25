import type {Page} from '@playwright/test';

/** Deliberately test-only: no app import, production route, signaling or recorder. */
interface TrialRuntime {stream:MediaStream|null;peer:RTCPeerConnection|null;remoteTracks:MediaStreamTrack[];joinCalls:number;captureCalls:number;audioContext:AudioContext|null;oscillator:OscillatorNode|null;oscillatorStopped:boolean;error:string|null;errorMessage:string|null}
declare global {interface Window {voiceTrial:TrialRuntime}}
export const TRIAL_ORIGIN='http://localhost:4186';

export async function prepareVoiceTrial(page:Page,source:'fakeCapture'|'synthetic'='fakeCapture'){
  await page.route(`${TRIAL_ORIGIN}/**`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Test-only fake audio trial</title><button id="join">Join fake audio</button><button id="mute">Mute</button><button id="leave">Leave</button><output id="state">Off</output>'}));
  await page.goto(`${TRIAL_ORIGIN}/voice-trial`);
  await page.evaluate(source=>{
    window.voiceTrial={stream:null,peer:null,remoteTracks:[],joinCalls:0,captureCalls:0,audioContext:null,oscillator:null,oscillatorStopped:false,error:null,errorMessage:null};
    const status=(text:string)=>{document.querySelector('#state')!.textContent=text;};
    const leave=async()=>{const trial=window.voiceTrial;trial.stream?.getTracks().forEach(track=>track.stop());trial.remoteTracks.forEach(track=>track.stop());trial.peer?.close();if(trial.oscillator&&!trial.oscillatorStopped){trial.oscillator.stop();trial.oscillatorStopped=true;}if(trial.audioContext&&trial.audioContext.state!=='closed')await trial.audioContext.close();status('Off');};
    document.querySelector<HTMLButtonElement>('#join')!.onclick=async()=>{
      const trial=window.voiceTrial;if(trial.peer&&trial.peer.connectionState!=='closed')await leave();trial.joinCalls++;trial.error=null;trial.errorMessage=null;
      try{if(source==='synthetic'){trial.audioContext=new AudioContext();const destination=trial.audioContext.createMediaStreamDestination();trial.oscillator=trial.audioContext.createOscillator();trial.oscillator.frequency.value=440;trial.oscillator.connect(destination);trial.oscillator.start();trial.oscillatorStopped=false;await trial.audioContext.resume();trial.stream=destination.stream;}else{trial.captureCalls++;trial.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});}trial.remoteTracks=[];trial.peer=new RTCPeerConnection({iceServers:[]});trial.peer.ontrack=event=>{trial.remoteTracks.push(event.track);};trial.stream.getAudioTracks().forEach(track=>trial.peer!.addTrack(track,trial.stream!));status('Ready');}
      catch(error){trial.error=error instanceof DOMException?error.name:'CaptureError';trial.errorMessage=error instanceof Error?error.message:null;status(trial.error);}
    };
    document.querySelector<HTMLButtonElement>('#mute')!.onclick=()=>{window.voiceTrial.stream?.getAudioTracks().forEach(track=>{track.enabled=false;});status('Muted');};
    document.querySelector<HTMLButtonElement>('#leave')!.onclick=leave;
    addEventListener('pagehide',leave);
  },source);
}
export async function description(page:Page,kind:'offer'|'answer'){
  return page.evaluate(async kind=>{
    const peer=window.voiceTrial.peer!;await peer.setLocalDescription(kind==='offer'?await peer.createOffer():await peer.createAnswer());
    if(peer.iceGatheringState!=='complete')await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Local ICE gathering did not complete')),10000);peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timeout);resolve();}});});
    return peer.localDescription!.toJSON();
  },kind);
}
export async function connectTrials(first:Page,second:Page){
  const offer=await description(first,'offer');await second.evaluate(offer=>window.voiceTrial.peer!.setRemoteDescription(offer),offer);
  const answer=await description(second,'answer');await first.evaluate(answer=>window.voiceTrial.peer!.setRemoteDescription(answer),answer);
}
export async function audioStats(page:Page){
  return page.evaluate(async()=>{
    const peer=window.voiceTrial.peer!,report=await peer.getStats();let receivedPackets=0,receivedBytes=0,sentPackets=0;const candidateTypes=new Set<string>(),selectedStates=new Set<string>();
    report.forEach(stat=>{if(stat.type==='inbound-rtp'&&stat.kind==='audio'){receivedPackets+=stat.packetsReceived??0;receivedBytes+=stat.bytesReceived??0;}if(stat.type==='outbound-rtp'&&stat.kind==='audio')sentPackets+=stat.packetsSent??0;if(stat.type==='local-candidate'||stat.type==='remote-candidate')candidateTypes.add(stat.candidateType);if(stat.type==='candidate-pair'&&stat.nominated)selectedStates.add(stat.state);});
    return {connectionState:peer.connectionState,receivedPackets,receivedBytes,sentPackets,candidateTypes:[...candidateTypes].sort(),selectedStates:[...selectedStates].sort(),iceServers:peer.getConfiguration().iceServers??[]};
  });
}
export async function trialState(page:Page){return page.evaluate(()=>{const t=window.voiceTrial;return {calls:t.joinCalls,captureCalls:t.captureCalls,error:t.error,errorMessage:t.errorMessage,audioContextState:t.audioContext?.state??null,oscillatorStopped:t.oscillatorStopped,connectionState:t.peer?.connectionState??null,tracks:t.stream?.getTracks().map(track=>({enabled:track.enabled,readyState:track.readyState,kind:track.kind}))??[],remoteTracks:t.remoteTracks.map(track=>({readyState:track.readyState,kind:track.kind}))};});}
