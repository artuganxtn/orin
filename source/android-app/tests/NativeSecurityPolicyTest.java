import com.orin.app.security.LockPolicy;
import com.orin.app.security.PinKdf;
import java.util.Arrays;
/** Runs without Android. Device/Keystore/biometric checks remain mandatory separately. */
public final class NativeSecurityPolicyTest {
    private static int checks;
    private static void check(boolean condition, String message) { checks++; if(!condition)throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        check(!LockPolicy.mustLock(false,false,false,1000,7,7,300999,300),"Before 5 minutes remains unlocked");
        check(LockPolicy.mustLock(false,false,false,1000,7,7,301000,300),"At 5 minutes locks");
        check(LockPolicy.mustLock(false,false,false,1000,7,7,1000,0),"Immediate locks at pause");
        check(LockPolicy.mustLock(false,true,true,-1,7,7,1000,300),"Abrupt process death fails closed");
        check(!LockPolicy.mustLock(false,true,false,1000,7,7,1001,300),"Persisted pause under timeout survives process restart");
        check(LockPolicy.mustLock(false,true,false,1000,7,8,500,300),"Reboot locks regardless of wall clock");
        check(LockPolicy.mustLock(false,true,false,1000,-1,-1,2000,300),"Unknown boot identity fails closed");
        check(LockPolicy.mustLock(false,false,false,1000,7,7,900,300),"Monotonic reversal fails closed");
        check(LockPolicy.mustLock(true,false,false,1000,7,7,1001,300),"Existing lock cannot be cleared by timeout");
        check(LockPolicy.mustLock(false,false,false,1000,7,7,61000,60),"1-minute option");
        check(!LockPolicy.mustLock(false,false,false,1000,7,7,900999,900),"15-minute grace");
        check(LockPolicy.mustLock(false,false,false,1000,7,7,901000,900),"15-minute boundary");
        boolean rejected=false;try{LockPolicy.timeout(301);}catch(IllegalArgumentException e){rejected=true;}check(rejected,"Unexpected settings rejected");
        check(LockPolicy.failureDelayMillis(4)==0,"Four attempts without delay");
        check(LockPolicy.failureDelayMillis(5)==30000,"Fifth failed PIN starts delay");
        check(LockPolicy.failureDelayMillis(6)==60000,"Progressive delay");
        check(LockPolicy.failureDelayMillis(15)==900000,"Delay bounded at15 minutes");
        check(LockPolicy.remainingDelay(7,7,31000,21000,30000)==10000,"Same boot remaining delay");
        check(LockPolicy.remainingDelay(7,8,31000,1000,30000)==30000,"Reboot cannot reset limiter");
        check(LockPolicy.remainingDelay(7,7,31000,31001,30000)==0,"Elapsed limit releases attempts");
        check(!PinKdf.valid("12345".toCharArray()),"Five-digit PIN rejected");
        check(!PinKdf.valid("12345x".toCharArray()),"Nonnumeric PIN rejected");
        check(!PinKdf.valid("1234567890123".toCharArray()),"Too-long PIN rejected");
        check(PinKdf.valid("593721".toCharArray()),"Six digits accepted");
        byte[] salt=new byte[32];Arrays.fill(salt,(byte)11);char[] pin="593721".toCharArray();
        byte[] hash=PinKdf.derive(pin,salt);
        check(hash.length==32,"256-bit verifier");
        check(Arrays.equals(pin,new char[6]),"PIN char buffer cleared");
        check(PinKdf.matches(hash,PinKdf.derive("593721".toCharArray(),salt)),"Correct PIN verifies");
        check(!PinKdf.matches(hash,PinKdf.derive("593722".toCharArray(),salt)),"Wrong PIN fails");
        salt[0]=12;check(!PinKdf.matches(hash,PinKdf.derive("593721".toCharArray(),salt)),"Salt prevents shared verifiers");
        Arrays.fill(hash,(byte)0);System.out.println("PASS "+checks+" native lock policy/KDF assertions (host JVM only)");
    }
}
