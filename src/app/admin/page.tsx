"use client";

import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { db, auth } from '@/lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';

const ADMIN_EMAILS = ['ppanfili@htsdnj.org', 'dpanfili@htsdnj.org'];

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const processData = (data: any[]) => {
    // Transform the parsed CSV rows into our required format
    return data.map(row => ({
      studentId: row['Student ID#'] || row['student_id'] || '',
      studentName: row['Student First/Last Name'] || row['student_name'] || '',
      teacherName: row['Teacher Name'] || row['teacher_name'] || '',
      homeroomNumber: row['Homeroom Number'] || row['homeroom'] || '',
      guardianName: row['Authorized Guardian Name(s)'] || row['guardian_name'] || ''
    })).filter(student => student.studentId && student.studentName); // Filter out empty rows
  };

  const handleUpload = () => {
    if (!file) return;

    setUploading(true);
    setStatus({ type: 'idle', message: 'Parsing file...' });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const students = processData(results.data);
          
          if (students.length === 0) {
            throw new Error("No valid students found. Please check your CSV column headers.");
          }

          setStatus({ type: 'idle', message: `Found ${students.length} students. Saving to database...` });

          // Use a batch write to efficiently save all students
          // Firestore batches max out at 500 operations, so we might need to chunk it for large schools,
          // but for now, we'll assume a standard batch size or chunk it just in case.
          
          const chunks = [];
          for (let i = 0; i < students.length; i += 500) {
            chunks.push(students.slice(i, i + 500));
          }

          for (const chunk of chunks) {
            const batch = writeBatch(db);
            chunk.forEach(student => {
              // We use the studentId as the document ID for easy lookup later
              const studentRef = doc(collection(db, 'students'), student.studentId.toString());
              batch.set(studentRef, student);
            });
            await batch.commit();
          }

          setStatus({ type: 'success', message: `Successfully uploaded and saved ${students.length} student records.` });
          setFile(null); // Reset
        } catch (error: any) {
          console.error("Upload error:", error);
          setStatus({ type: 'error', message: error.message || "An error occurred during upload." });
        } finally {
          setUploading(false);
        }
      },
      error: (error) => {
        setStatus({ type: 'error', message: `Parse error: ${error.message}` });
        setUploading(false);
      }
    });
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
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-5">
            <h1 className="text-xl font-bold text-gray-900">Admin Data Engine</h1>
            <p className="text-sm text-gray-500 mt-1">Upload the PowerSchool CSV export to synchronize the validation list.</p>
          </div>
          
          <div className="p-6">
            <div className="mb-6 bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
              <strong>Required CSV Columns:</strong>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Student ID#</li>
                <li>Student First/Last Name</li>
                <li>Teacher Name</li>
                <li>Homeroom Number</li>
                <li>Authorized Guardian Name(s)</li>
              </ul>
            </div>

            <div className="mt-2 flex justify-center rounded-lg border border-dashed border-gray-900/25 px-6 py-10">
              <div className="text-center">
                <UploadCloud className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
                <div className="mt-4 flex text-sm leading-6 text-gray-600 justify-center">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer rounded-md bg-white font-semibold text-blue-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2 hover:text-blue-500"
                  >
                    <span>Upload a file</span>
                    <input id="file-upload" name="file-upload" type="file" accept=".csv" className="sr-only" onChange={handleFileChange} />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs leading-5 text-gray-600">CSV files up to 10MB</p>
                {file && <p className="mt-2 text-sm font-medium text-green-600 border border-green-200 bg-green-50 py-1 px-3 rounded-full inline-block">Selected: {file.name}</p>}
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className={`w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {uploading ? 'Processing & Uploading...' : 'Sync Database'}
              </button>
            </div>

            {status.message && (
              <div className={`mt-4 p-4 rounded-md flex items-start gap-3 ${status.type === 'success' ? 'bg-green-50 text-green-800' : status.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
                {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" /> : status.type === 'error' ? <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" /> : null}
                <div>
                  <h3 className="text-sm font-medium">{status.message}</h3>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
