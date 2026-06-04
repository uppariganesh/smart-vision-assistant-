/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, CameraOff, Volume2, VolumeX, AlertTriangle, Info, Play, Square, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VisionService, DetectionResult } from './services/visionService';
import { VoiceService } from './services/voiceService';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User } from './firebase';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [status, setStatus] = useState<string>('Camera OFF. Ready to start.');
  const [lastResult, setLastResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visionServiceRef = useRef<VisionService | null>(null);
  const voiceServiceRef = useRef<VoiceService | null>(null);
  const processingRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const testAudio = async () => {
    await voiceServiceRef.current?.unlock();
    voiceServiceRef.current?.beep(440, 0.2);
    await voiceServiceRef.current?.speak("Audio check. Voice guidance is active.");
  };

  // Initialize services and Auth
  useEffect(() => {
    try {
      visionServiceRef.current = new VisionService();
      voiceServiceRef.current = new VoiceService();
    } catch (err) {
      setError('AI Service configuration error. Please check your API key.');
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser) {
        const name = currentUser.displayName?.split(' ')[0] || 'User';
        const isSpecialUser = currentUser.email === 'uppariganesh200@gmail.com' || currentUser.email === 'uppariganesh2007@gmail.com';
        const welcomeMsg = isSpecialUser 
          ? `Welcome, ${name}. Access granted to your personal assistant.`
          : `Welcome back, ${name}.`;
        voiceServiceRef.current?.speak(welcomeMsg);
      } else {
        voiceServiceRef.current?.speak("Please sign in to use the vision assistant.");
      }
    });

    // Fallback for slow auth
    const timer = setTimeout(() => {
      setIsAuthLoading(false);
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleLogin = async () => {
    setError(null);
    try {
      await voiceServiceRef.current?.unlock();
      voiceServiceRef.current?.speak("Opening Google sign in...");
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Login error:", err);
      let msg = "Login failed. Please try again.";
      if (err.code === 'auth/popup-blocked') {
        msg = "Sign-in popup was blocked. Please allow popups for this site.";
      } else if (err.code === 'auth/cancelled-popup-request') {
        msg = "Sign-in was cancelled.";
      }
      setError(msg);
      voiceServiceRef.current?.speak(msg);
    }
  };

  const handleGuestMode = () => {
    setUser({
      uid: 'guest-user',
      displayName: 'Guest User',
      email: 'guest@example.com',
      photoURL: null,
    } as any);
    setIsAuthLoading(false);
    voiceServiceRef.current?.speak("Continuing as guest. Some features may be limited.");
  };

  const handleLogout = async () => {
    try {
      if (isActive) stopCamera();
      await signOut(auth);
      voiceServiceRef.current?.speak("Signed out successfully.");
    } catch (err: any) {
      console.error(err);
    }
  };

  const startCamera = async () => {
    // Unlock audio for mobile
    await voiceServiceRef.current?.unlock();

    try {
      // Stop existing tracks if any
      const currentStream = videoRef.current?.srcObject as MediaStream;
      currentStream?.getTracks().forEach(track => track.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsActive(true);
        setStatus(`Camera ON (${facingMode === 'user' ? 'Front' : 'Back'}). Analyzing...`);
        await voiceServiceRef.current?.speak(`Vision assistant started using ${facingMode === 'user' ? 'front' : 'rear'} camera.`);
        startAnalysisLoop();
      }
    } catch (err: any) {
      const errorMessage = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Camera access denied. Please enable camera permissions in your browser settings and refresh.'
        : `Error: ${err.message || 'Could not access camera'}`;
      setError(errorMessage);
      console.error('Camera Error:', err);
    }
  };

  const toggleCamera = () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (isActive) {
      // Restart camera with new mode
      stopCamera();
      setTimeout(() => startCamera(), 500);
    }
  };

  const stopCamera = async () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    
    setIsActive(false);
    setStatus('Camera OFF. Assistant stopped.');
    if (intervalRef.current) clearInterval(intervalRef.current);
    voiceServiceRef.current?.cancel();
    await voiceServiceRef.current?.speak('Vision assistant stopped.');
  };

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  }, []);

  const processFrame = useCallback(async () => {
    if (processingRef.current || !isActive) return;
    
    const base64Image = captureFrame();
    if (!base64Image) return;

    processingRef.current = true;
    setIsAnalyzing(true);
    try {
      const result = await visionServiceRef.current?.analyzeFrame(base64Image);
      if (result) {
        setLastResult(result);
        setStatus(result.summary);
        
        if (isVoiceEnabled) {
          // If high urgency alerts exist, beep first
          const hasHighUrgency = result.alerts.some(a => a.urgency === 'high');
          if (hasHighUrgency) {
            voiceServiceRef.current?.beep(660, 0.1);
          }

          // Speak alerts
          for (const alert of result.alerts) {
            let message = '';
            if (alert.type === 'obstacle') {
              message = `${alert.label} ${alert.position}, ${alert.distance} away.`;
            } else if (alert.type === 'drop') {
              message = `CAUTION: Drop detected ${alert.position}, ${alert.distance} away. ${alert.label}.`;
            } else if (alert.type === 'rise') {
              message = `Step up detected ${alert.position}, ${alert.distance} away. ${alert.label}.`;
            } else if (alert.type === 'clear') {
              message = 'The path ahead is clear.';
            }
            
            if (message) {
              await voiceServiceRef.current?.speak(message, alert.urgency === 'high');
            }
          }

          // Speak spatial layout if available
          if (result.depthMap?.description) {
            await voiceServiceRef.current?.speak(result.depthMap.description);
          }

          // Special detection for People
          if (result.peopleDetected && result.peopleDetected.length > 0) {
            for (const person of result.peopleDetected) {
              if (person.confidence > 0.75) {
                let announcement = '';
                if (person.name.toLowerCase().includes('ganesh')) {
                  announcement = 'Ganesh detected. Welcome back, Ganesh.';
                } else if (person.name.toLowerCase().includes('akshay')) {
                  announcement = 'Akshay Kumar detected center. Your friend is here.';
                } else if (person.name.toLowerCase().includes('vaibhav')) {
                  announcement = 'Vaibhav detected on the left.';
                } else {
                  announcement = `${person.name} detected ${person.position}.`;
                }
                await voiceServiceRef.current?.speak(announcement, true);
              }
            }
          }

          // Special detection for Phone
          if (result.phoneDetected?.detected) {
            const phoneMsg = `Phone detected ${result.phoneDetected.position}, ${result.phoneDetected.distance} away.`;
            await voiceServiceRef.current?.speak(phoneMsg, true);
          }
        }
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      if (err.message?.includes('permission') || err.message?.includes('403')) {
        setError('AI Service Permission Denied. Please check your API key configuration.');
      }
    } finally {
      processingRef.current = false;
      setIsAnalyzing(false);
    }
  }, [isActive, isVoiceEnabled, captureFrame]);

  const startAnalysisLoop = () => {
    // Analyze every 2 seconds to balance real-time needs and API limits
    intervalRef.current = window.setInterval(processFrame, 2000);
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-yellow-400 text-2xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white font-sans flex flex-col items-center justify-center p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-4">
            <h1 className="text-5xl font-bold text-yellow-400 tracking-tight">SMART VISION</h1>
            <p className="text-xl text-gray-400">Your AI-powered accessibility companion.</p>
          </div>

          <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 space-y-6">
            <p className="text-gray-300">To ensure your safety and provide personalized assistance, please sign in.</p>
            <div className="space-y-4">
              <button
                onClick={handleLogin}
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-black py-6 rounded-2xl flex items-center justify-center gap-4 transition-all active:scale-95 shadow-xl"
                aria-label="Sign in with Google"
              >
                <LogIn size={32} />
                <span className="text-2xl font-bold uppercase">Sign In</span>
              </button>
              
              <button
                onClick={handleGuestMode}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 border border-gray-700"
                aria-label="Continue as Guest"
              >
                <span className="text-lg font-medium">Continue as Guest</span>
              </button>
            </div>
          </div>

          <p className="text-gray-600 text-sm">
            Designed for the visually impaired. Voice guidance will assist you after login.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col p-4 md:p-8">
      {/* Header */}
      <header className="mb-8 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-bold text-yellow-400 tracking-tight">
              SMART VISION
            </h1>
            <p className="text-gray-400 text-sm">Welcome, {user.displayName?.split(' ')[0]}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleLogout}
            className="p-4 rounded-full bg-gray-800 text-white hover:bg-red-600 transition-colors"
            aria-label="Sign out"
            title="Sign Out"
          >
            <LogOut size={28} />
          </button>
          <button 
            onClick={testAudio}
            className="p-4 rounded-full bg-gray-800 text-yellow-400 hover:bg-gray-700 transition-colors"
            aria-label="Test audio"
            title="Test Audio"
          >
            <Volume2 size={32} />
          </button>
          <button 
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            className={`p-4 rounded-full transition-colors ${isVoiceEnabled ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-white'}`}
            aria-label={isVoiceEnabled ? "Disable voice guidance" : "Enable voice guidance"}
          >
            {isVoiceEnabled ? <Volume2 size={32} /> : <VolumeX size={32} />}
          </button>
          <button 
            onClick={toggleCamera}
            className="p-4 rounded-full bg-gray-800 text-yellow-400 hover:bg-gray-700 transition-colors"
            aria-label="Toggle camera"
            title="Switch Camera"
          >
            <Camera size={32} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        
        {/* Camera Preview */}
        <div className="relative aspect-video bg-gray-900 rounded-3xl overflow-hidden border-4 border-gray-800 shadow-2xl">
          {/* Camera Status Badge */}
          <div className={`absolute top-4 left-4 z-20 px-4 py-2 rounded-full font-bold text-sm uppercase tracking-widest flex items-center gap-2 shadow-lg ${isActive ? 'bg-green-500 text-white' : 'bg-red-600 text-white'}`}>
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-white'}`} />
            {isActive ? 'Camera On' : 'Camera Off'}
          </div>

          {/* Depth Map Visualization */}
          <AnimatePresence>
            {isActive && lastResult?.depthMap && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute top-4 right-4 z-20 bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/20 shadow-2xl w-40"
              >
                <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-bold text-center">3D Depth Map (m)</div>
                <div className="grid grid-cols-3 gap-1">
                  {lastResult.depthMap.grid.flat().map((dist, idx) => (
                    <div 
                      key={idx}
                      className="aspect-square rounded-md flex items-center justify-center text-[10px] font-mono font-bold transition-colors duration-500"
                      style={{
                        backgroundColor: `rgba(250, 204, 21, ${Math.max(0.1, 1 - dist / 5)})`,
                        color: dist < 1 ? 'black' : 'white'
                      }}
                    >
                      {dist.toFixed(1)}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[9px] text-gray-300 leading-tight italic text-center">
                  {lastResult.depthMap.description}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className={`w-full h-full object-cover transition-opacity duration-500 ${isActive ? 'opacity-100' : 'opacity-0'}`}
          />
          <canvas ref={canvasRef} className="hidden" />
          
          {!isActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
              <CameraOff size={64} className="mb-4 opacity-20" />
              <p className="text-xl font-medium">Camera is off</p>
            </div>
          )}

          {/* Overlay Alerts */}
          <AnimatePresence>
            {isActive && lastResult?.peopleDetected?.map((person, idx) => (
              person.confidence > 0.7 && (
                <motion.div
                  key={`person-${person.name}-${idx}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className={`absolute z-30 bg-yellow-400 text-black px-6 py-3 rounded-full font-black text-xl shadow-2xl border-4 border-black animate-bounce ${
                    person.position === 'left' ? 'top-1/4 left-4' : 
                    person.position === 'right' ? 'top-1/4 right-4' : 
                    'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
                  }`}
                >
                  {person.name.toUpperCase()} DETECTED
                </motion.div>
              )
            ))}

            {isActive && lastResult?.phoneDetected?.detected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold text-xl shadow-2xl border-2 border-white flex items-center gap-3"
              >
                <div className="w-3 h-3 bg-white rounded-full animate-ping" />
                PHONE DETECTED: {lastResult.phoneDetected.distance}
              </motion.div>
            )}

            {isActive && lastResult?.alerts.map((alert, idx) => (
              <motion.div
                key={`${alert.label}-${idx}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`absolute bottom-4 left-4 right-4 p-4 rounded-xl flex items-center gap-3 backdrop-blur-md ${
                  alert.urgency === 'high' ? 'bg-red-600/90 text-white' : 'bg-yellow-400/90 text-black'
                }`}
              >
                {alert.urgency === 'high' ? <AlertTriangle size={24} /> : <Info size={24} />}
                <div className="flex-1">
                  <p className="font-bold uppercase text-sm tracking-wider">{alert.type}</p>
                  <p className="text-lg font-medium">{alert.label} - {alert.position}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase opacity-70">Distance</p>
                  <p className="font-bold">{alert.distance}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Status Display */}
        <div className="bg-gray-900 p-6 rounded-3xl border border-gray-800 relative overflow-hidden">
          {isAnalyzing && (
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              className="absolute top-0 left-0 h-1 w-full bg-yellow-400 opacity-50"
            />
          )}
          <h2 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-2 flex justify-between">
            <span>System Status</span>
            {isAnalyzing && <span className="text-yellow-400 animate-pulse">Analyzing...</span>}
          </h2>
          <p className={`text-2xl font-medium ${isActive ? 'text-green-400' : 'text-gray-400'}`}>
            {status}
          </p>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-auto">
          {!isActive ? (
            <button
              onClick={startCamera}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black py-8 rounded-3xl flex flex-col items-center justify-center gap-2 transition-all active:scale-95 shadow-lg"
            >
              <Play size={48} fill="currentColor" />
              <span className="text-2xl font-black uppercase">Start Assistant</span>
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="w-full bg-red-600 hover:bg-red-500 text-white py-8 rounded-3xl flex flex-col items-center justify-center gap-2 transition-all active:scale-95 shadow-lg"
            >
              <Square size={48} fill="currentColor" />
              <span className="text-2xl font-black uppercase">Stop Assistant</span>
            </button>
          )}
          
          <div className="bg-gray-800 p-6 rounded-3xl flex flex-col justify-center">
            <h3 className="text-yellow-400 font-bold mb-2 flex items-center gap-2">
              <Info size={20} /> Instructions
            </h3>
            <ul className="text-gray-300 text-sm space-y-1 list-disc pl-4">
              <li>Point camera in front of you</li>
              <li>Ensure good lighting for better detection</li>
              <li>Voice guidance will announce obstacles and distances (e.g., 1m, 2m)</li>
              <li>High contrast UI for low-vision users</li>
              <li className="text-yellow-400 font-medium italic">iOS Users: Ensure your silent switch is OFF</li>
            </ul>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-900/50 border border-red-500 text-red-200 rounded-xl text-center">
            {error}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 text-center text-gray-600 text-sm">
        Smart Vision Assistant &copy; 2026 | AI Powered Accessibility
      </footer>
    </div>
  );
}
