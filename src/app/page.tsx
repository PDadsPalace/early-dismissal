"use client";

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { 
  isSignInWithEmailLink, 
  signInWithEmailLink, 
  sendSignInLinkToEmail, 
  onAuthStateChanged,
  User,
  signOut
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, addDoc, deleteDoc, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { CheckCircle2, AlertCircle, Mail, School, ArrowRight, CheckSquare, Clock } from 'lucide-react';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  
  // Handshake state
  const [isLinked, setIsLinked] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [parentName, setParentName] = useState('');
  
  // Multi-child State
  const [unlinkedSiblings, setUnlinkedSiblings] = useState<any[]>([]);
  const [isLinkingAnother, setIsLinkingAnother] = useState(false);

  // Pending Link Request State
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Express Lane State
  const [currentStep, setCurrentStep] = useState(1);
  const [parentData, setParentData] = useState<any>(null);
  const [linkedStudentsData, setLinkedStudentsData] = useState<any[]>([]);
  
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [releaseReason, setReleaseReason] = useState('');
  const [notifications, setNotifications] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let emailForSignIn = window.localStorage.getItem('emailForSignIn');
      if (!emailForSignIn) {
        emailForSignIn = window.prompt('Please provide your email for confirmation');
      }
      if (emailForSignIn) {
        signInWithEmailLink(auth, emailForSignIn, window.location.href)
          .then(async (result) => {
            window.localStorage.removeItem('emailForSignIn');
            window.history.replaceState(null, '', window.location.pathname);
            checkLinkedStatus(result.user);
          })
          .catch(() => {
            setStatus({ type: 'error', message: 'Error signing in. The link may have expired.' });
          });
      }
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        checkLinkedStatus(currentUser);
        setupRequestListener(currentUser.uid);
      } else {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const setupRequestListener = (uid: string) => {
    const q = query(
      collection(db, 'linkRequests'),
      where('userId', '==', uid)
    );
    onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const req = change.doc.data();
        if (change.type === 'added' || change.type === 'modified') {
          if (req.status === 'pending') {
            setAwaitingApproval(true);
            setCurrentRequestId(change.doc.id);
          } else if (req.status === 'denied' && change.doc.id === currentRequestId) {
            setAwaitingApproval(false);
            setStatus({ type: 'error', message: 'Denied, please type your full first and last name' });
            setCurrentRequestId(null);
            // Delete the denied request so it doesn't trigger again
            deleteDoc(doc(db, 'linkRequests', change.doc.id));
          } else if (req.status === 'approved' && change.doc.id === currentRequestId) {
            setAwaitingApproval(false);
            setCurrentRequestId(null);
            if (auth.currentUser) {
              checkLinkedStatus(auth.currentUser);
            }
            // Delete the approved request to clean up
            deleteDoc(doc(db, 'linkRequests', change.doc.id));
          }
        }
      });
    });
  };

  const checkLinkedStatus = async (currentUser: User) => {
    try {
      const parentDoc = await getDoc(doc(db, 'parents', currentUser.uid));
      if (parentDoc.exists()) {
        const pData = parentDoc.data();
        setParentData(pData);
        setIsLinked(true);

        // Fetch the details of their linked students
        if (pData.linkedStudents && pData.linkedStudents.length > 0) {
          const studentPromises = pData.linkedStudents.map((id: string) => getDoc(doc(db, 'students', id)));
          const studentDocs = await Promise.all(studentPromises);
          const students = studentDocs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }));
          setLinkedStudentsData(students);
          
          // Pre-select if there's only one child
          if (students.length === 1) {
            setSelectedStudents([students[0].id]);
          }
        }
      } else {
        setIsLinked(false);
      }
    } catch (error) {
      console.error("Error checking link status", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: 'idle', message: 'Sending link...' });
    
    const actionCodeSettings = { url: window.location.origin, handleCodeInApp: true };
    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
      setStatus({ type: 'success', message: 'Check your email! A secure login link has been sent.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  const handleHandshake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setStatus({ type: 'idle', message: 'Verifying...' });

    try {
      const studentDocRef = doc(db, 'students', studentId);
      const studentDoc = await getDoc(studentDocRef);

      if (studentDoc.exists()) {
        const studentData = studentDoc.data();
        
        // SECURITY VALIDATION: Exact match first, otherwise request approval
        const guardianNameLower = (studentData.guardianName || '').toLowerCase().trim();
        const parentNameLower = parentName.trim().toLowerCase();
        
        if (guardianNameLower !== parentNameLower) {
          // Submit Link Request to Office
          const reqRef = await addDoc(collection(db, 'linkRequests'), {
            userId: user.uid,
            userEmail: user.email,
            studentId: studentId,
            studentName: studentData.studentName,
            guardianNameOnRecord: studentData.guardianName,
            parentNameProvided: parentName,
            status: 'pending',
            timestamp: new Date().toISOString()
          });
          setCurrentRequestId(reqRef.id);
          setAwaitingApproval(true);
          setStatus({ type: 'success', message: 'Name verification required. The front office is reviewing your request.' });
          return;
        }

        if (parentName.trim().length > 2) {
          if (isLinked && parentData) {
            // Adding a subsequent child
            const updatedLinked = [...parentData.linkedStudents, studentId];
            await setDoc(doc(db, 'parents', user.uid), {
              ...parentData,
              linkedStudents: updatedLinked
            });
            
            const updatedUnlinked = unlinkedSiblings.filter(s => s.id !== studentId);
            setUnlinkedSiblings(updatedUnlinked);
            
            if (updatedUnlinked.length > 0) {
              setStudentId('');
              setStatus({ type: 'success', message: `${studentData.studentName} connected. You can link another.` });
            } else {
              setIsLinkingAnother(false);
              await checkLinkedStatus(user);
              setStatus({ type: 'success', message: 'All children connected securely!' });
            }
          } else {
            // Initial child
            await setDoc(doc(db, 'parents', user.uid), {
              email: user.email,
              parentName: parentName,
              linkedStudents: [studentId],
              createdAt: new Date().toISOString()
            });

            // Find siblings
            const q = query(collection(db, 'students'), where('guardianName', '==', studentData.guardianName));
            const querySnapshot = await getDocs(q);
            const siblings = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            
            const remaining = siblings.filter(s => s.id !== studentId);
            
            if (remaining.length > 0) {
              setUnlinkedSiblings(remaining);
              setIsLinkingAnother(true);
              setIsLinked(true);
              setParentData({
                email: user.email,
                parentName: parentName,
                linkedStudents: [studentId]
              });
              setStudentId('');
              setStatus({ type: 'success', message: `${studentData.studentName} has been connected!` });
            } else {
              await checkLinkedStatus(user);
              setStatus({ type: 'success', message: 'Account securely linked!' });
            }
          }
        } else {
          setStatus({ type: 'error', message: 'Please enter your full name.' });
        }
      } else {
        setStatus({ type: 'error', message: 'Information does not match school records. Please see the front office.' });
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: 'An error occurred during verification.' });
    }
  };

  const toggleStudent = (id: string) => {
    setSelectedStudents(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleNotification = (type: string) => {
    setNotifications(prev => 
      prev.includes(type) ? prev.filter(n => n !== type) : [...prev, type]
    );
  };

  const handleSubmitSignout = async () => {
    if (!user || !parentData) return;
    setIsSubmitting(true);
    
    try {
      // Create a sign-out record for each selected student
      const selectedStudentDetails = linkedStudentsData.filter(s => selectedStudents.includes(s.id));
      
      const records = selectedStudentDetails.map(student => ({
        timestamp: new Date().toISOString(),
        parentEmail: user.email,
        parentName: parentData.parentName,
        studentId: student.id,
        studentName: student.studentName,
        teacher: student.teacherName,
        homeroom: student.homeroomNumber,
        reason: releaseReason,
        notifications: notifications,
        status: 'Pending', // Office changes this to 'Dismissed'
      }));

      // In production, you might batch this. Using simple addDoc for each record.
      for (const record of records) {
        await addDoc(collection(db, 'signouts'), record);
      }

      setCurrentStep(5); // Success Screen
    } catch (error) {
      console.error("Submission failed", error);
      alert("Failed to submit. Please try again or see the front office.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogOut = async () => {
    try {
      await signOut(auth);
      setIsLinked(false);
      setParentData(null);
      setLinkedStudentsData([]);
      setSelectedStudents([]);
      setCurrentStep(1);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  const handleUnlinkAccount = async () => {
    if (!user || !parentData) return;
    
    if (!window.confirm("Are you sure you want to delete your registered account? You will need to start from scratch and register again.")) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'parents', user.uid));
      setIsLinked(false);
      setParentData(null);
      setLinkedStudentsData([]);
      setSelectedStudents([]);
      setCurrentStep(1);
    } catch (error) {
      console.error("Error unlinking account", error);
      alert("Failed to delete account. Please try again.");
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-pulse text-blue-600 font-semibold">Loading...</div></div>;
  }

  // --- VIEW 1.5: LINK ANOTHER CHILD ---
  if (user && isLinked && isLinkingAnother) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Connect Another Child</h1>
          <p className="text-sm text-gray-500 text-center mb-6">Enter their Student ID to link them to your account.</p>

          <form onSubmit={handleHandshake} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Another Student ID#</label>
              <input 
                type="text" 
                required
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder="e.g. 55083"
              />
            </div>
            
            <button type="submit" className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
              Verify & Link Child
            </button>
            <button type="button" onClick={async () => { 
                setIsLinkingAnother(false); 
                await checkLinkedStatus(user); 
              }} 
              className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
              No, skip for now
            </button>
          </form>

          {status.message && (
            <div className={`mt-4 p-3 rounded-md flex items-start gap-2 ${status.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{status.message}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW 1: THE EXPRESS LANE (Daily Pickup Flow) ---
  if (user && isLinked && parentData && !isLinkingAnother) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 pb-24">
        <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          
          <div className="bg-blue-600 px-6 py-8 text-white text-center">
            <School className="mx-auto h-12 w-12 text-white/90 mb-3" />
            <h1 className="text-2xl font-bold">Welcome Back, {parentData.parentName.split(' ')[0]}!</h1>
            <p className="text-sm text-blue-100 mt-1 opacity-80">{user.email}</p>
          </div>
          
          <div className="p-6">
            {/* Step 1: Scan ID */}
            {currentStep === 1 && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-center">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-blue-600 font-bold">1</span>
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">Physical ID Required</h3>
                  <p className="text-sm text-gray-600 mt-2">Please scan your physical ID on the Main Entrance Door Scanner now before proceeding.</p>
                </div>
                <button 
                  onClick={() => setCurrentStep(2)}
                  className="w-full flex items-center justify-center gap-2 py-4 px-4 border border-transparent rounded-xl shadow-md text-base font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all"
                >
                  I have scanned my ID <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Step 2: Logistics */}
            {currentStep === 2 && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Who are you picking up?</h3>
                  <div className="space-y-2">
                    {linkedStudentsData.map(student => (
                      <label key={student.id} className={`flex items-center p-4 border rounded-xl cursor-pointer transition-colors ${selectedStudents.includes(student.id) ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input 
                          type="checkbox" 
                          checked={selectedStudents.includes(student.id)}
                          onChange={() => toggleStudent(student.id)}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="ml-3">
                          <p className="font-medium text-gray-900">{student.studentName}</p>
                          <p className="text-xs text-gray-500">Teacher: {student.teacherName}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Reason for Early Release</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {['Doctor/Dentist', 'Illness', 'Family Appt', 'Other'].map(reason => (
                      <label key={reason} className={`flex items-center justify-center p-3 border rounded-xl text-sm font-medium cursor-pointer transition-colors ${releaseReason === reason ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                        <input 
                          type="radio" 
                          name="reason" 
                          value={reason}
                          checked={releaseReason === reason}
                          onChange={(e) => setReleaseReason(e.target.value)}
                          className="sr-only"
                        />
                        {reason}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button onClick={() => setCurrentStep(1)} className="px-4 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50">Back</button>
                  <button 
                    onClick={() => setCurrentStep(3)}
                    disabled={selectedStudents.length === 0 || !releaseReason}
                    className="flex-1 py-3 px-4 border border-transparent rounded-xl shadow-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Notifications */}
            {currentStep === 3 && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Who needs to be notified?</h3>
                  <p className="text-sm text-gray-500 mb-4">Select all that apply for today.</p>
                  <div className="space-y-3">
                    {['Classroom Teacher', 'Bus Coordinator', 'Aftercare'].map(notif => (
                      <label key={notif} className={`flex items-center p-4 border rounded-xl cursor-pointer transition-colors ${notifications.includes(notif) ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input 
                          type="checkbox" 
                          checked={notifications.includes(notif)}
                          onChange={() => toggleNotification(notif)}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="ml-3 font-medium text-gray-900">{notif}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button onClick={() => setCurrentStep(2)} className="px-4 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50">Back</button>
                  <button 
                    onClick={() => setCurrentStep(4)}
                    className="flex-1 py-3 px-4 border border-transparent rounded-xl shadow-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Review & Sign
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Submission */}
            {currentStep === 4 && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Summary</h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">Picking up:</span> <span className="font-medium text-gray-900">{linkedStudentsData.filter(s => selectedStudents.includes(s.id)).map(s => s.studentName).join(', ')}</span></p>
                    <p><span className="text-gray-500">Reason:</span> <span className="font-medium text-gray-900">{releaseReason}</span></p>
                    {notifications.length > 0 && <p><span className="text-gray-500">Notifying:</span> <span className="font-medium text-gray-900">{notifications.join(', ')}</span></p>}
                  </div>
                </div>

                <div className="border-l-4 border-blue-500 bg-blue-50/50 p-4 rounded-r-xl">
                  <p className="text-sm text-blue-900 italic">
                    "I, <strong>{parentData.parentName}</strong>, acknowledge I am picking up the student(s) listed above and have scanned my physical ID."
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button onClick={() => setCurrentStep(3)} className="px-4 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50">Back</button>
                  <button 
                    onClick={handleSubmitSignout}
                    disabled={isSubmitting}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-md font-bold text-white bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting...' : 'Digitally Sign & Submit'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Success */}
            {currentStep === 5 && (
              <div className="text-center py-8 animate-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckSquare className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Request Submitted!</h2>
                <p className="text-gray-600 mb-8">The front office has been notified. Please wait by the designated pickup area.</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full py-4 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50"
                >
                  Done
                </button>
              </div>
            )}

          </div>
          
          {/* Account Management */}
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex flex-col gap-3">
            <button 
              onClick={() => { setStudentId(''); setIsLinkingAnother(true); }}
              className="w-full py-2 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md text-sm font-medium transition-colors"
            >
              + Link Another Child
            </button>
            <div className="flex justify-between items-center px-2">
              <button 
                onClick={handleLogOut}
                className="text-xs text-gray-500 hover:text-gray-800 font-medium transition-colors"
              >
                Log Out
              </button>
              <button 
                onClick={handleUnlinkAccount}
                className="text-xs text-gray-500 hover:text-red-600 font-medium transition-colors"
              >
                Delete Registered Account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW 2: THE HANDSHAKE (Setup Phase) ---
  if (user && !isLinked) {
    if (awaitingApproval) {
      return (
        <div className="min-h-screen bg-gray-50 p-6 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Clock className="w-10 h-10 text-blue-600 animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Awaiting Approval</h2>
            <p className="text-gray-600 mb-6">Your name did not exactly match our automatic records. The front office has been notified and is reviewing your connection request.</p>
            <div className="flex justify-center">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 p-6 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Account Setup</h1>
          <p className="text-sm text-gray-500 text-center mb-6">Let's securely link your account to your student.</p>

          <form onSubmit={handleHandshake} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student ID#</label>
              <input 
                type="text" 
                required
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder="e.g. 55082"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Full Name</label>
              <input 
                type="text" 
                required
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder="Exactly as it appears on school records"
              />
            </div>

            <button type="submit" className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
              Verify & Link Account
            </button>
          </form>

          {status.message && (
            <div className={`mt-4 p-3 rounded-md flex items-start gap-2 ${status.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{status.message}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW 3: EMAIL SIGN-IN ---
  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col justify-center">
      <div className="max-w-md mx-auto w-full bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="text-center mb-6">
          <School className="mx-auto h-12 w-12 text-blue-600" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Parent Sign-Out</h1>
          <p className="text-sm text-gray-500 mt-1">Please enter your email to receive a secure login link.</p>
        </div>

        <form onSubmit={handleSendLink} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-gray-400" />
              </div>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <button type="submit" className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
            Send Secure Link
          </button>
        </form>

        {status.message && (
          <div className={`mt-4 p-3 rounded-md flex items-start gap-2 ${status.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            <p className="text-sm">{status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
