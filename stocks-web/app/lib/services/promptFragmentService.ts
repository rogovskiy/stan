import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get all prompt fragments for a ticker
 */
export async function getPromptFragments(ticker: string): Promise<any[]> {
  try {
    const fragmentsRef = collection(db, 'tickers', ticker.toUpperCase(), 'prompt_fragments');
    const querySnapshot = await getDocs(fragmentsRef);
    
    const fragments: any[] = [];
    querySnapshot.forEach((doc) => {
      fragments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by order if available, then by created_at
    fragments.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : Infinity;
      const orderB = b.order !== undefined ? b.order : Infinity;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const createdA = a.created_at || '';
      const createdB = b.created_at || '';
      return createdA.localeCompare(createdB);
    });
    
    return fragments;
  } catch (error) {
    console.error(`Error getting prompt fragments for ${ticker}:`, error);
    return [];
  }
}

/**
 * Save a prompt fragment (create or update)
 */
export async function savePromptFragment(
  ticker: string,
  fragment: { id?: string; title: string; content: string }
): Promise<any> {
  try {
    const upperTicker = ticker.toUpperCase();
    const now = new Date().toISOString();
    
    const fragmentData: any = {
      title: fragment.title,
      content: fragment.content,
      updated_at: now
    };
    
    if (fragment.id) {
      // Update existing fragment
      const fragmentRef = doc(db, 'tickers', upperTicker, 'prompt_fragments', fragment.id);
      const fragmentSnap = await getDoc(fragmentRef);
      
      if (fragmentSnap.exists()) {
        const existingData = fragmentSnap.data();
        // Preserve created_at if it exists
        if (existingData?.created_at) {
          fragmentData.created_at = existingData.created_at;
        }
        await updateDoc(fragmentRef, fragmentData);
        return {
          id: fragment.id,
          ...fragmentData
        };
      } else {
        throw new Error(`Prompt fragment with ID ${fragment.id} not found`);
      }
    } else {
      // Create new fragment - generate an ID
      const fragmentsRef = collection(db, 'tickers', upperTicker, 'prompt_fragments');
      const newFragmentRef = doc(fragmentsRef);
      
      fragmentData.created_at = now;
      
      await setDoc(newFragmentRef, fragmentData);
      
      return {
        id: newFragmentRef.id,
        ...fragmentData
      };
    }
  } catch (error) {
    console.error(`Error saving prompt fragment for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Delete a prompt fragment by ID
 */
export async function deletePromptFragment(ticker: string, id: string): Promise<void> {
  try {
    const fragmentRef = doc(db, 'tickers', ticker.toUpperCase(), 'prompt_fragments', id);
    const fragmentSnap = await getDoc(fragmentRef);
    
    if (!fragmentSnap.exists()) {
      throw new Error(`Prompt fragment with ID ${id} not found`);
    }
    
    await deleteDoc(fragmentRef);
  } catch (error) {
    console.error(`Error deleting prompt fragment ${id} for ${ticker}:`, error);
    throw error;
  }
}



