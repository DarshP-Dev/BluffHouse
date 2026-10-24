import type {Command} from '@bluff-house/shared';
import {reserve,release,commit,settle,credit} from './ledger.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

const bidKey=(r:Room,p:Player)=>`${r.matchId}:${r.party!.auction.id}:${p.id}:house-bid`;

export function startAuction(r:Room,e:EngineOptions,now:number){
  const initialBonusReserve=r.players.filter(p=>p.participating).length*100;
  r.party={bounties:[],houseId:null,houseSinceRound:0,overthrowHistory:[],vault:0,bonusReserve:initialBonusReserve,initialBonusReserve,vaultDistributed:false,transfers:[],social:null,socialRound:0,duelHistory:[],dealHistory:[],chaos:{inventories:{},usedRound:{},emergencyUsed:[],grantedRounds:[],multipliers:{},potTwist:null,handWindow:null,ordinaryHits:{}},auction:{id:e.id(),deadline:now+20000,status:'open',bids:{},winnerId:null,winningBid:null}};
  r.phase='HOUSE_AUCTION';r.deadline=r.party.auction.deadline;r.roundId=undefined;r.bettingId=undefined;r.decisionId=undefined;r.activePlayerId=undefined;
  for(const p of r.players)p.status=p.participating?'waiting':'observer';
}

export function submitBid(r:Room,p:Player,c:Command){
  requireRule(r.mode==='PARTY'&&r.party&&r.phase==='HOUSE_AUCTION'&&r.party.auction.status==='open','AUCTION_CLOSED');
  requireRule(p.participating,'NOT_PARTICIPATING');requireRule(c.auctionId===r.party.auction.id,'STALE_AUCTION');
  const amount=c.payload?.amount;requireRule(typeof amount==='number'&&Number.isSafeInteger(amount)&&(amount===0||(amount>=50&&amount<=300&&amount%50===0)),'INVALID_BID','Bid 50–300 chips in steps of 50, or pass.');
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
}

/** Called in settled player-seat order. It never reduces the player's payout. */
export function payCommission(r:Room,p:Player,profit:number):number{
  const party=r.party;if(!party?.houseId||p.id===party.houseId||profit<=0)return 0;
  const id=`${r.roundId}:${p.id}:house-commission`;
  if(party.transfers.some(t=>t.id===id))return 0;
  const used=party.transfers.filter(t=>t.kind==='commission'&&t.roundId===r.roundId).reduce((n,t)=>n+t.amount,0);
  const amount=Math.min(Math.floor(3*profit/100),Math.max(0,50-used));if(!amount)return 0;
  const house=r.players.find(player=>player.id===party.houseId&&player.participating);requireRule(house,'HOUSE_MISSING');
  if(!credit(house.account,id,amount))return 0;
  r.dealerNet+=amount;party.transfers.push({id,kind:'commission',amount,from:'DEALER_BANK',to:house.id,roundId:r.roundId});return amount;
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
