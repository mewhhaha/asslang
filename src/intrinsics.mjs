import { reusablePullback } from './reverse.mjs';
import { reusableLinearize, valueAndGradient, stopGradient } from './differential.mjs';
// Closed compiler registry: source programs cannot install handlers or gain I/O.
export const intrinsicArities=Object.freeze({pullback:2,linearize:2,value_and_grad:2,stop_gradient:1});
export function inferIntrinsic(name,{a,b,Num,fn}) {
  if(name==='pullback')return fn([fn([a],b),a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['pullback',fn([b],a)]])});
  if(name==='linearize')return fn([fn([a],b),a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['pushforward',fn([a],b)]])});
  if(name==='value_and_grad')return fn([fn([a],Num),a],{tag:'Record',tail:null,
    fields:new Map([['value',Num],['gradient',a]])});
  if(name==='stop_gradient')return fn([a],a);
  return null;
}
export function stageIntrinsic(name,args,api,at) {
  if(name==='pullback')return reusablePullback(...args,api,at);
  if(name==='linearize')return reusableLinearize(...args,api,at);
  if(name==='value_and_grad')return valueAndGradient(...args,api,at);
  if(name==='stop_gradient')return stopGradient(args[0],api,at);
  api.fail(`Unknown intrinsic '${name}'`,at,'E_NAME');
}
