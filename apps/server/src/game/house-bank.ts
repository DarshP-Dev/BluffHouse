import {RULES,validBetAmount,type HouseBankView,type HouseRoundSettlement} from '@bluff-house/shared';
import {available,credit,reserve,release,commit,settle} from './ledger.js';
import {requireRule,type Room,type Player,type HouseBankState} from './state.js';

export function initialBank(r:Room):HouseBankState{return {initial:2*r.initialChips,balance:2*r.initialChips,liabilities:{},bond:{ownerId:null,amount:0,reservationId:null},rounds:[],bondHistory:[],dealerAutomated:false};}
export function isHouse(r:Room,p:Player|string):boolean{return !!r.party?.houseId&&r.party.houseId===(typeof p==='string'?p:p.id);}
export function liabilityKey(r:Room,p:Player){return p.wagerId??`${r.roundId}:${p.id}:blackjack`;}
export function bankCommitted(r:Room){return Object.values(r.party?.bank.liabilities??{}).reduce((sum,item)=>sum+item.amount,0);}
export function bankAvailable(r:Room){return r.party?r.party.bank.balance+r.party.bank.bond.amount-bankCommitted(r):RULES.maxBet;}
export function maximumBackedBet(r:Room,p:Player,includeCommitted=false){
  if(isHouse(r,p))return 0;
  const funds=available(p.account)+(p.wagerId?p.account.reservations[p.wagerId]??(includeCommitted?p.account.escrows[p.wagerId]??0:0):0);
  if(!r.party)return Math.min(funds,RULES.maxBet);
  const capacity=bankAvailable(r)+(r.party.bank.liabilities[liabilityKey(r,p)]?.amount??0);
  return Math.min(funds,RULES.maxBet,Math.floor((2*capacity+1)/3));
}
export function reserveLiability(r:Room,p:Player,stake:number){
  if(!r.party)return;requireRule(!isHouse(r,p),'HOUSE_CANNOT_BET','The House plays the dealer hand and cannot place an opposing wager.');
  requireRule(validBetAmount(stake),'INVALID_AMOUNT');
  const bank=r.party.bank,key=liabilityKey(r,p),amount=Math.floor(3*stake/2),previous=bank.liabilities[key];
  requireRule(!previous||previous.roundId===r.roundId,'STALE_LIABILITY');
  requireRule(amount<=bankAvailable(r)+(previous?.amount??0),'INSUFFICIENT_BANK_BACKING','The finite Table Bank cannot back that wager. Choose a smaller amount.');
  bank.liabilities[key]={playerId:p.id,roundId:r.roundId!,amount,committed:previous?.committed??false};
}
export function releaseLiability(r:Room,p:Player){if(r.party)delete r.party.bank.liabilities[liabilityKey(r,p)];}
export function commitLiability(r:Room,p:Player){if(r.party){const record=r.party.bank.liabilities[liabilityKey(r,p)];requireRule(record&&record.amount===Math.floor(3*p.wager/2),'MISSING_BANK_LIABILITY');record.committed=true;}}
export function releaseHouseBond(r:Room,id:string){
  const bank=r.party?.bank;if(!bank||!bank.bond.ownerId)return;
  requireRule(bankCommitted(r)===0,'BOND_HAS_LIVE_LIABILITIES');
  requireRule(!bank.bondHistory.some(item=>item.id===id),'DUPLICATE_BOND_ID');
  const bond=bank.bond,player=r.players.find(p=>p.id===bond.ownerId)!;
  if(bond.reservationId)release(player.account,bond.reservationId);
  bank.bondHistory.push({id,kind:'release',ownerId:player.id,amount:bond.amount});bank.bond={ownerId:null,amount:0,reservationId:null};
}
export function takeHouseBond(r:Room,ownerId:string,id:string){
  const bank=r.party!.bank;requireRule(!bank.bond.ownerId,'BOND_ALREADY_HELD');
  requireRule(bankCommitted(r)===0,'BOND_HAS_LIVE_LIABILITIES');
  requireRule(!bank.bondHistory.some(item=>item.id===id),'DUPLICATE_BOND_ID');
  const owner=r.players.find(p=>p.id===ownerId&&p.participating)!;requireRule(owner,'HOUSE_MISSING');
  const amount=Math.min(250,available(owner.account)),reservationId=`${r.matchId}:${id}:${ownerId}:house-bond`;
  if(amount)reserve(owner.account,reservationId,amount);
  bank.bond={ownerId,amount,reservationId};bank.bondHistory.push({id,kind:'entry',ownerId,amount});
}
/** Net all hands before distributing profit, so seat order cannot change earnings. */
export function settleBankRound(r:Room,losingStakes:number,winningProfits:number):HouseRoundSettlement|null{
  const party=r.party;if(!party)return null;const bank=party.bank,id=`${r.matchId}:${r.roundId}:bank-settlement`;
  requireRule([losingStakes,winningProfits].every(amount=>Number.isSafeInteger(amount)&&amount>=0),'INVALID_BANK_SETTLEMENT');
  const existing=bank.rounds.find(item=>item.id===id);if(existing){requireRule(existing.losingStakes===losingStakes&&existing.winningProfits===winningProfits,'SETTLEMENT_CONFLICT');return existing;}
  requireRule(winningProfits-losingStakes<=bank.balance+bank.bond.amount,'BANK_INSOLVENT');
  const record:HouseRoundSettlement={id,roundId:r.roundId!,houseId:party.houseId,payouts:r.roundPayouts.map(item=>({...item})),losingStakes,winningProfits,net:losingStakes-winningProfits,bondLoss:0,bankLoss:0,recovery:0,houseEarnings:0,bankEarnings:0};
  const owner=bank.bond.ownerId?r.players.find(p=>p.id===bank.bond.ownerId):undefined;
  if(record.net<0){
    const loss=-record.net;record.bondLoss=Math.min(loss,bank.bond.amount);record.bankLoss=loss-record.bondLoss;
    if(record.bondLoss){
      requireRule(owner&&bank.bond.reservationId,'HOUSE_BOND_MISSING');release(owner.account,bank.bond.reservationId);
      const lossId=`${id}:bond-loss`;reserve(owner.account,lossId,record.bondLoss);commit(owner.account,lossId);settle(owner.account,lossId,0);
      bank.bond.amount-=record.bondLoss;if(bank.bond.amount)reserve(owner.account,bank.bond.reservationId,bank.bond.amount);
    }
    requireRule(bank.balance>=record.bankLoss,'BANK_INSOLVENT');bank.balance-=record.bankLoss;
  }else{
    record.recovery=Math.min(record.net,Math.max(0,bank.initial-bank.balance));bank.balance+=record.recovery;
    const residual=record.net-record.recovery;record.houseEarnings=owner?Math.floor(residual/2):0;record.bankEarnings=residual-record.houseEarnings;bank.balance+=record.bankEarnings;
    if(owner&&record.houseEarnings){requireRule(credit(owner.account,`${id}:house-earnings`,record.houseEarnings),'DUPLICATE_HOUSE_EARNINGS');bank.bond.amount+=Math.min(record.houseEarnings,250-bank.bond.amount);if(bank.bond.amount)reserve(owner.account,bank.bond.reservationId!,bank.bond.amount);}
  }
  for(const [key,item] of Object.entries(bank.liabilities))if(item.roundId===r.roundId)delete bank.liabilities[key];
  bank.rounds.push(record);r.dealerNet=bank.initial-bank.balance;return record;
}
export function projectBank(r:Room):HouseBankView{const bank=r.party!.bank;return {initial:bank.initial,balance:bank.balance,available:bankAvailable(r),committed:bankCommitted(r),bond:{ownerId:bank.bond.ownerId,amount:bank.bond.amount},rounds:bank.rounds.map(item=>({...item,payouts:item.payouts.map(payout=>({...payout}))}))};}
export function validBondReservation(r:Room,p:Player,key:string){const bond=r.party?.bank.bond;return !!bond&&bond.ownerId===p.id&&bond.reservationId===key&&bond.amount>0&&p.account.reservations[key]===bond.amount;}
export function assertHouseBank(r:Room){
  const bank=r.party?.bank;if(!bank)return;
  requireRule(bank.initial===2*r.initialChips&&Number.isSafeInteger(bank.balance)&&bank.balance>=0&&r.dealerNet===bank.initial-bank.balance,'BANK_BALANCE_INVARIANT');
  requireRule(bankAvailable(r)>=0&&new Set(bank.rounds.map(item=>item.id)).size===bank.rounds.length&&new Set(bank.bondHistory.map(item=>item.id)).size===bank.bondHistory.length,'BANK_HISTORY_INVARIANT');
  const bond=bank.bond;requireRule(Number.isSafeInteger(bond.amount)&&bond.amount>=0&&bond.amount<=250,'BOND_AMOUNT_INVARIANT');
  if(bond.ownerId){const owner=r.players.find(p=>p.id===bond.ownerId);requireRule(owner&&bond.ownerId===r.party!.houseId&&bond.reservationId&&(bond.amount?owner.account.reservations[bond.reservationId]===bond.amount:!Object.hasOwn(owner.account.reservations,bond.reservationId)),'BOND_RESERVATION_INVARIANT');}
  else requireRule(bond.amount===0&&bond.reservationId===null,'RELEASED_BOND_INVARIANT');
  for(const p of r.players)for(const key of Object.keys(p.account.reservations))if(key.endsWith(':house-bond'))requireRule(validBondReservation(r,p,key),'ORPHAN_BOND_INVARIANT');
  for(const p of r.players)if(p.wagerId&&(Object.hasOwn(p.account.reservations,p.wagerId)||Object.hasOwn(p.account.escrows,p.wagerId)))requireRule(!!bank.liabilities[p.wagerId],'UNBACKED_WAGER_INVARIANT');
  for(const [key,item] of Object.entries(bank.liabilities)){const p=r.players.find(p=>p.id===item.playerId);requireRule(p&&!isHouse(r,p)&&p.wagerId===key&&item.roundId===r.roundId&&item.amount===Math.floor(3*p.wager/2)&&item.committed===Object.hasOwn(p.account.escrows,key),'BANK_LIABILITY_INVARIANT');}
  for(const item of bank.rounds)requireRule(item.net===item.losingStakes-item.winningProfits&&[item.losingStakes,item.winningProfits,item.bondLoss,item.bankLoss,item.recovery,item.houseEarnings,item.bankEarnings].every(n=>Number.isSafeInteger(n)&&n>=0)&&(item.net<0?-item.net===item.bondLoss+item.bankLoss:item.net===item.recovery+item.houseEarnings+item.bankEarnings),'BANK_SETTLEMENT_INVARIANT');
  for(const item of bank.rounds)if(item.payouts.length)requireRule(item.losingStakes===item.payouts.reduce((sum,p)=>sum+Math.max(0,-p.profit),0)&&item.winningProfits===item.payouts.reduce((sum,p)=>sum+Math.max(0,p.profit),0)&&item.payouts.every(p=>Number.isSafeInteger(p.stake)&&p.stake>0&&Number.isSafeInteger(p.returned)&&p.returned>=0&&p.profit===p.returned-p.stake&&p.houseCommission===0),'BANK_PAYOUT_HISTORY_INVARIANT');
}
