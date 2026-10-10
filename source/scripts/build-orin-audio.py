"""ORIN original procedural sound family. No recordings or third-party samples."""
from pathlib import Path
import math, wave, struct, subprocess
root=Path('public/audio');root.mkdir(parents=True,exist_ok=True)
sr=44100
# A shared open fifth + ninth motif, restrained transients, warm sine partials.
patterns={'standard':([(0,659.255,.38),(.11,987.767,.46)],.78), 'opportunity':([(0,659.255,.35),(.1,987.767,.4),(.21,1318.51,.48)],.95), 'security':([(0,493.883,.35),(.19,659.255,.42),(.33,987.767,.48)],1.1), 'sonic-logo':([(0,329.628,.7),(.23,493.883,.65),(.47,659.255,.66),(.75,987.767,.7),(.99,1318.51,.65)],1.85)}
for name,(notes,length) in patterns.items():
 samples=[]
 for i in range(int(sr*length)):
  t=i/sr;v=0.
  for onset,freq,duration in notes:
   dt=t-onset
   if 0<=dt<=duration:
    env=(1-math.exp(-dt/0.009))*math.exp(-dt/0.17)*(max(0,1-dt/duration)**.6)
    v+=(math.sin(2*math.pi*freq*dt)+.16*math.sin(2*math.pi*freq*2*dt)+.035*math.sin(2*math.pi*freq*3*dt))*env
  samples.append(v)
 peak=max(abs(x) for x in samples) or 1
 with wave.open(str(root/(name+'.wav')),'wb') as out:
  out.setparams((1,2,sr,0,'NONE','not compressed'))
  out.writeframes(b''.join(struct.pack('<h',int(x/peak*10362)) for x in samples))
 for ext,codec in [('ogg','libvorbis'),('caf','pcm_s16le')]:
  subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-i',str(root/(name+'.wav')),'-c:a',codec,str(root/(name+'.'+ext))],check=True)
print('Created four original sound motifs as WAV / OGG / CAF.')
