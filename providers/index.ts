import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { getMovieboxStreams } from './movies/moviebox.js';
import { getCastleStreams as getMovieCastle } from './movies/castle.js';
import { getNetmirrorStreams as getMovieNetmirror } from './movies/netmirror.js';
import { getVidlinkStreams as getMovieVidlink } from './movies/vidlink.js';
import { getDaratechStreams as getMovieDaratech } from './movies/daratech.js';
import { getMovieboxStreams as getTvMoviebox } from './tv/moviebox.js';
import { getCastleStreams as getTvCastle } from './tv/castle.js';
import { getNetmirrorStreams as getTvNetmirror } from './tv/netmirror.js';
import { getVidlinkStreams as getTvVidlink } from './tv/vidlink.js';
import { getDaratechStreams as getTvDaratech } from './tv/daratech.js';
import { getMovieboxDownloads } from './downloads/moviebox.js';
import { get4khdhubDownloads } from './downloads/4khdhub.js';
import { getDvdplayDownloads } from './downloads/dvdplay.js';
import { getStreamflixDownloads } from './downloads/streamflix.js';
import { getAnikotoStreams } from './anime/anikoto.js';
import { getKaaStreams } from './anime/kaa.js';
import { getAnimeggStreams } from './anime/animegg.js';
import { getReanimeStreams } from './anime/reanime.js';
import { getAnimedunyaStreams } from './anime/animedunya.js';
import { getAninekoStreams } from './anime/anineko.js';
import { getAnidbappStreams } from './anime/anidbapp.js';
import { getAnibdStreams } from './anime/anibd.js';
import { attachedSubtitles, buildDownloadResponse, buildStreamResponse } from './normalizer.js';
import { recordFailure, recordSuccess, isHealthy, getHealthRecords } from './health.js';
import type { AnimeProviderInput, MovieProviderInput, ProviderCategory, RawDownload, RawStream, TvProviderInput } from './shared/types.js';

const app = Fastify({ logger: true, trustProxy: true });
const env = { secret: process.env.X_SPUN_SECRET ?? '', movieboxBase: process.env.MOVIEBOX_API_BASE ?? 'https://moviebox.byspun.xyz', movieboxSecret: process.env.MOVIEBOX_API_SECRET ?? '', daratechBase: process.env.DARATECH_API_BASE ?? 'https://apimovie.runflix.name.ng/v1', daratechKey: process.env.DARATECH_API_KEY ?? '', tmdbKey: process.env.TMDB_API_KEY ?? '' };
function auth(request: any): boolean { return Boolean(env.secret) && request.headers['x-spun-secret'] === env.secret; }
function input(q: any): any { const type=String(q.type); if(type==='anime') return {type,anilist_id:Number(q.anilist_id),mal_id:q.mal_id?Number(q.mal_id):null,title:String(q.title),episode:Number(q.episode??1),dub:String(q.audio??'').toLowerCase()==='dub'} as AnimeProviderInput & {type:'anime'}; if(type==='tv') return {type,tmdb_id:Number(q.tmdb_id),imdb_id:q.imdb_id??null,title:String(q.title),year:q.year?Number(q.year):null,season:Number(q.season??1),episode:Number(q.episode??1)} as TvProviderInput & {type:'tv'}; return {type,tmdb_id:Number(q.tmdb_id),imdb_id:q.imdb_id??null,title:String(q.title),year:q.year?Number(q.year):null} as MovieProviderInput & {type:'movie'}; }
async function streamFor(value: any): Promise<{streams: RawStream[]; subtitles: any[]}> { const streams:RawStream[]=[]; let subs:any[]=[]; const attempts:any[] = value.type==='anime' ? [['anikoto',getAnikotoStreams],['kaa',getKaaStreams],['animegg',getAnimeggStreams],['reanime',getReanimeStreams],['animedunya',getAnimedunyaStreams],['anineko',getAninekoStreams],['anidbapp',getAnidbappStreams],['anibd',getAnibdStreams]] : value.type==='tv' ? [['moviebox', (x:any)=>getTvMoviebox(x,env.tmdbKey)],['daratech',(x:any)=>getTvDaratech(x,{baseUrl:env.daratechBase,apiKey:env.daratechKey})],['castle',(x:any)=>getTvCastle(x,env.tmdbKey)],['netmirror',(x:any)=>getTvNetmirror(x,env.tmdbKey)],['vidlink',(x:any)=>getTvVidlink(x,env.tmdbKey)]] : [['moviebox',(x:any)=>getMovieboxStreams(x,env.tmdbKey)],['daratech',(x:any)=>getMovieDaratech(x,{baseUrl:env.daratechBase,apiKey:env.daratechKey})],['castle',(x:any)=>getMovieCastle(x,env.tmdbKey)],['netmirror',(x:any)=>getMovieNetmirror(x,env.tmdbKey)],['vidlink',(x:any)=>getMovieVidlink(x,env.tmdbKey)]]; for(const [id,fn] of attempts){ if(!isHealthy(id,value.type)) continue; try { const result=await fn(value); if(result.length){recordSuccess(id,value.type); streams.push(...result); subs.push(...attachedSubtitles(result)); break;} recordFailure(id,value.type,'no usable result'); } catch(e){recordFailure(id,value.type,e);} } return {streams,subtitles:subs}; }
async function downloadsFor(value:any):Promise<{downloads:RawDownload[];subtitles:any[]}> { const providers:any[]=[['moviebox',(x:any)=>getMovieboxDownloads(x,{baseUrl:env.movieboxBase,apiKey:env.movieboxSecret})],['4khdhub',(x:any)=>get4khdhubDownloads(x,env.tmdbKey)],['streamflix',(x:any)=>getStreamflixDownloads(x,env.tmdbKey)]]; if(value.type==='movie') providers.splice(2,0,['dvdplay',(x:any)=>getDvdplayDownloads(x,env.tmdbKey)]); for(const [id,fn] of providers){try{const result=await fn(value);if(result.length)return {downloads:result,subtitles:[]};}catch{}} return {downloads:[],subtitles:[]}; }
await app.register(cors,{origin:['https://media.byspun.xyz','https://torii.byspun.xyz'],methods:['GET','OPTIONS'],allowedHeaders:['Content-Type','X-Spun-Secret']});
app.addHook('onRequest',async(request,reply)=>{if(request.url==='/health')return;if(!auth(request))return reply.code(401).send({code:'UNAUTHORIZED',error:'Authentication required',description:'The provider gateway request was not authenticated.',action:'Retry through the Spün gateway.'});});
app.get('/health',async()=>{const records=getHealthRecords();const degraded=records.some((record)=>record.status==='down');return {status:degraded?'degraded':'ok',capabilities:{streaming:true,downloads:true,anime:true},content_resolution:{status:degraded?'degraded':'healthy',checked_at:new Date().toISOString()}};});
app.get('/stream',async(request,reply)=>{const q:any=request.query;const value=input(q);if(!value.title||!Number.isFinite(value.type==='anime'?value.anilist_id:value.tmdb_id))return reply.code(400).send({code:'BAD_REQUEST',error:'Malformed request',description:'The content request is incomplete.',action:'Retry with a resolved title and identifier.'});const result=await streamFor(value);if(!result.streams.length)return reply.code(503).send({code:'STREAMS_UNAVAILABLE',error:'No playable streams found',description:'No usable stream was found across the available infrastructure.',action:'Try again later or select another title.'});return reply.send(buildStreamResponse(String(q.spun_id),value.title,value.type,result.streams,result.subtitles));});
app.get('/download',async(request,reply)=>{const q:any=request.query;const value=input(q);if(!value.title)return reply.code(400).send({code:'BAD_REQUEST',error:'Malformed request',description:'The content request is incomplete.',action:'Retry with a resolved title and identifier.'});const result=await downloadsFor(value);if(!result.downloads.length)return reply.code(503).send({code:'DOWNLOADS_UNAVAILABLE',error:'No downloads found',description:'No usable download was found across the available infrastructure.',action:'Try again later or choose another quality.'});const batch=value.type!=='movie'&&!q.season&&!q.episode;return reply.send(buildDownloadResponse(String(q.spun_id),value.title,value.type,result.downloads,result.subtitles,batch));});
app.setErrorHandler((_error,_request,reply)=>reply.code(500).send({code:'INTERNAL_ERROR',error:'Unexpected error',description:'The provider gateway could not complete the request.',action:'Please try again later.'}));
await app.listen({port:Number(process.env.PORT??10000),host:'0.0.0.0'});
