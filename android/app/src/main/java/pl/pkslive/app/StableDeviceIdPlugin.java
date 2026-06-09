package pl.pkslive.app;

import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "StableDeviceId")
public class StableDeviceIdPlugin extends Plugin {
  @PluginMethod
  public void getId(PluginCall call) {
    String androidId = Settings.Secure.getString(
      getContext().getContentResolver(),
      Settings.Secure.ANDROID_ID
    );

    JSObject result = new JSObject();
    result.put("identifier", androidId == null ? "" : androidId);
    call.resolve(result);
  }
}
