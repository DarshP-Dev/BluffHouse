import type {Command} from '@bluff-house/shared';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

export function chatCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const raw=c.payload?.text;requireRule(typeof raw==='string','INVALID_CHAT','Write a message of 1–280 characters.');
  const text=raw.replace(/\r\n?/g,'\n').trim();
  requireRule(Array.from(text).length>=1&&Array.from(text).length<=280&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|\p{Cs}/u.test(text),'INVALID_CHAT','Write 1–280 valid Unicode characters without control characters.');
  const recent=(r.chatRates[p.id]??[]).filter(at=>now-at<10000);
  requireRule(!recent.length||now-recent.at(-1)!>=1000,'CHAT_COOLDOWN','Wait one second between messages.');
  requireRule(recent.length<5,'CHAT_BURST','Send at most five messages in ten seconds.');
  for(const [id,times] of Object.entries(r.chatRates))if(times.every(at=>now-at>=10000))delete r.chatRates[id];
  r.chatRates[p.id]=[...recent,now];r.chat.push({id:e.id(),playerId:p.id,username:p.name,text,at:now});r.chat=r.chat.slice(-100);
}

export function assertChat(r:Room){
  requireRule(r.chat.length<=100&&new Set(r.chat.map(message=>message.id)).size===r.chat.length,'CHAT_HISTORY_INVARIANT');
  for(const message of r.chat)requireRule(typeof message.id==='string'&&typeof message.playerId==='string'&&typeof message.username==='string'&&Array.from(message.text).length>=1&&Array.from(message.text).length<=280&&Number.isFinite(message.at),'CHAT_MESSAGE_INVARIANT');
  for(const times of Object.values(r.chatRates))requireRule(times.length<=5&&times.every((at,index)=>Number.isFinite(at)&&(index===0||at-times[index-1]!>=1000)),'CHAT_RATE_INVARIANT');
}
