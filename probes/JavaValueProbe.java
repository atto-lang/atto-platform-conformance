import java.nio.file.Files;
import java.nio.file.Path;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;

/** Java/GraalVM guest-value probe, independent of process exit code truncation. */
class JavaValueProbe {
  public static void main(String[] argv) throws Exception {
    if(argv.length != 1)throw new IllegalArgumentException("one fixture file required");
    var path=Path.of(argv[0]).toAbsolutePath().normalize();
    if(!Files.isRegularFile(path))throw new IllegalArgumentException("missing fixture");
    var source=Source.newBuilder("ores",Files.readString(path),path.getFileName().toString())
        .mimeType("application/x-oreslang").build();
    try(Context context=Context.newBuilder("ores").allowAllAccess(false).build()) {
      Value parsed=context.parse(source);
      Value result=parsed.execute("__ores_internal_invoke_public__","main");
      if(!result.fitsInLong())throw new IllegalStateException("main() did not return signed i64");
      System.out.println(Long.toString(result.asLong()));
    }
  }
}
