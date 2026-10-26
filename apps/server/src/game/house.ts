import type {Command} from '@bluff-house/shared';
import {reserve,release,commit,settle,credit} from './ledger.js';
import {initialBank,takeHouseBond} from './house-bank.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

const bidKey=(r:Room,p:Player)=>`${r.matchId}:${r.party!.auction.id}:${p.id}:house-bid`;

export function startAuction(r:Room,e:EngineOptions,now:number){
  const initialBonusReserve=r.players.filter(p=>p.participating).length*100;
  const enabled=r.settings.house;
  r.party={bank:initialBank(r),bounties:[],houseId:null,houseSinceRound:0,overthrowHistory:[],vault:0,bonusReserve:initialBonusReserve,initialBonusReserve,vaultDistributed:false,transfers:[],social:null,socialRound:0,duelHistory:[],dealHistory:[],shadow:null,chaos:{inventories:{},usedRound:{},emergencyUsed:[],grantedRounds:[],multipliers:{},potTwist:null,handWindow:null,ordinaryHits:{}},auction:{id:e.id(),deadline:now+(enabled?20000:0),status:enabled?'open':'revealed',bids:{},winnerId:null,winningBid:enabled?null:0}};
  r.phase=enabled?'HOUSE_AUCTION':'BETTING';r.deadline=enabled?r.party.auction.deadline:null;r.roundId=undefined;r.bettingId=undefined;r.decisionId=undefined;r.activePlayerId=undefined;
  for(const p of r.players)p.status=p.participating?'waiting':'observer';
}

export function submitBid(r:Room,p:Player,c:Command){
  requireRule(r.mode==='PARTY'&&r.party&&r.phase==='HOUSE_AUCTION'&&r.party.auction.status==='open','AUCTION_CLOSED');
  requireRule(p.participating,'NOT_PARTICIPATING');requireRule(c.auctionId===r.party.auction.id,'STALE_AUCTION');
  const amount=c.payload?.amount;requireRule(typeof amount==='number'&&Number.isSafeInteger(amount)&&(amount===0||(amount>=50&&amount<=900&&amount%50===0)),'INVALID_BID','Bid 50–900 chips in steps of 50, or pass.');
  requireRule(amount===0||amount<p.account.balance,'BID_REQUIRES_BOND','A winning bid must leave at least one personal chip for the House bond.');
  if(amount===0)release(p.account,bidKey(r,p));else reserve(p.account,bidKey(r,p),amount);
  r.party.auction.bids[p.id]=amount;
}

export function closeAuction(r:Room,e:EngineOptions){
  const party=r.party;requireRule(party,'PARTY_REQUIRED');if(party.auction.status!=='open')return;
  const participants=r.players.filter(p=>p.participating);
  const highest=Math.max(0,...participants.map(p=>party.auction.bids[p.id]??0));
  const tied=participants.filter(p=>(party.auction.bids[p.id]??0)===highest);
  const winner=highest>0?tied[e.randomIndex(tied.length)]:undefined;
  if(highest>0)requireRule(winner,'INVALID_RANDOM_INDEX');
  for(const p of participants){
    const id=bidKey(r,p);
    if(p===winner){const paid=commit(p.account,id);requireRule(paid===highest,'BID_RESERVATION_MISMATCH');settle(p.account,id,0);party.vault+=paid;party.transfers.push({id,kind:'auction',amount:paid,from:p.id,to:'VAULT'});}
    else release(p.account,id);
  }
  party.houseId=winner?.id??null;party.auction.winnerId=party.houseId;party.auction.winningBid=highest;party.auction.status='revealed';
  if(winner)takeHouseBond(r,winner.id,party.auction.id);
}

/** Interim funded finale and early-ending fallback; absent participants keep shares. */
export function distributeVault(r:Room){
  const party=r.party;if(!party||party.vaultDistributed)return;
  requireRule(party.auction.status==='revealed','AUCTION_UNSETTLED');
  const players=r.players.filter(p=>p.participating).sort((a,b)=>a.seat-b.seat);
  requireRule(players.length>0,'NO_PARTICIPANTS');
  const each=Math.floor(party.vault/players.length),remainder=party.vault%players.length;
  for(const [index,p] of players.entries()){
    const amount=each+(index<remainder?1:0),id=`${r.matchId}:${p.id}:vault-distribution`;
    if(credit(p.account,id,amount)){party.vault-=amount;party.transfers.push({id,kind:'vault_distribution',amount,from:'VAULT',to:p.id});}
  }
  party.vaultDistributed=true;
}
