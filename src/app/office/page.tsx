"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { CheckCircle2, Clock, FileText, School, AlertCircle } from 'lucide-react';

const ADMIN_EMAILS = ['ppanfili@htsdnj.org', 'dpanfili@htsdnj.org'];

interface SignoutRecord {
  id: string;
  timestamp: string;
  parentEmail: string;
  parentName: string;
  studentId: string;
  studentName: string;
  teacher: string;
  homeroom: string;
  reason: string;
  notifications: string[];
  status: 'Pending' | 'Dismissed';
}

export default function OfficeDashboard() {
  const [activeSignouts, setActiveSignouts] = useState<SignoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Real-time listener for pending signouts
    const q = query(
      collection(db, 'signouts'), 
      where('status', '==', 'Pending'),
      // orderBy requires a composite index in Firestore if combined with where, 
      // so for now we'll fetch Pending and sort client-side to prevent index errors on fresh setups
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: SignoutRecord[] = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() } as SignoutRecord);
      });
      
      // Sort newest first (descending)
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      setActiveSignouts(records);
      setLoading(false);
    }, (err) => {
      console.error("Firestore listener error:", err);
      setError("Failed to connect to the live database.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDismiss = async (recordId: string) => {
    try {
      const recordRef = doc(db, 'signouts', recordId);
      await updateDoc(recordRef, {
        status: 'Dismissed',
        dismissedAt: new Date().toISOString()
      });
      // The onSnapshot listener will automatically remove this row from the active list
    } catch (err) {
      console.error("Error dismissing student:", err);
      alert("Failed to mark as dismissed. Please check your connection.");
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-pulse text-blue-600 font-semibold">Loading...</div></div>;
  }

  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-gray-600 mb-6">You do not have administrative privileges. Please log in with an authorized account on the homepage first.</p>
        <a href="/" className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700">Return to Home</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <School className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Front Office Dashboard</h1>
                <p className="text-sm text-gray-500 font-medium">Live Early Dismissal Queue</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-sm font-medium border border-blue-100">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
              Live Sync Active
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Date/Time</th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Student</th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">HR / Teacher</th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Parent (Signature)</th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Reason & Alerts</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      <div className="flex justify-center items-center gap-2">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                        Loading live queue...
                      </div>
                    </td>
                  </tr>
                ) : activeSignouts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
                        <h3 className="text-lg font-medium text-gray-900">All Clear</h3>
                        <p className="text-gray-500 mt-1">There are no pending early dismissals at this time.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  activeSignouts.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors animate-in fade-in duration-300">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900">
                          <Clock className="w-4 h-4 mr-2 text-gray-400" />
                          <span className="font-bold">{formatTime(record.timestamp)}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 ml-6">{formatDate(record.timestamp)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-gray-900">{record.studentName}</div>
                        <div className="text-xs text-gray-500 mt-1">ID: {record.studentId}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{record.teacher}</div>
                        <div className="text-xs font-medium text-gray-500 mt-1 bg-gray-100 inline-block px-2 py-0.5 rounded">Rm: {record.homeroom}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-900">{record.parentName}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <FileText className="w-3 h-3 text-green-600" />
                          <span className="text-xs font-medium text-green-600">Verified e-Sig</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{record.parentEmail}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 font-medium">{record.reason}</div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {record.notifications?.map(notif => (
                            <span key={notif} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                              Notify: {notif}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleDismiss(record.id)}
                          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                        >
                          Mark Dismissed
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
