'use client';
import {Component,type ReactNode} from 'react';
import {diagnostic} from '@/lib/diagnostics';
export class ChartBoundary extends Component<{children:ReactNode;resetKey:string;retry?:()=>void},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error:Error){diagnostic('chart','render_failed',{error:error.message.slice(0,300)})}
 componentDidUpdate(previous:{resetKey:string}){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false})}
 render(){return this.state.failed?<div className="native-feed-state" role="alert"><b>تعذر عرض الشارت · Chart unavailable</b><button className="btn-outline" onClick={()=>{this.props.retry?.();this.setState({failed:false})}}>إعادة المحاولة · Retry</button></div>:this.props.children}
}
